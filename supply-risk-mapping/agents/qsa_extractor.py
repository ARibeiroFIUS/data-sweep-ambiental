"""
Agent 1 — Extrator de QSA (Quadro Societário e Administrativo)
Dado um CNPJ, extrai todos os sócios e administradores,
incluindo recursão para sócios PJ (até 2 níveis).
"""
import re
import requests
import time
from datetime import datetime, date
from typing import Optional
from config import OPENCNPJ_BASE, OPENCNPJ_RATE_LIMIT


def limpar_cnpj(cnpj: str) -> str:
    """Remove formatação do CNPJ, mantendo apenas dígitos."""
    return re.sub(r"\D", "", cnpj)


def formatar_cnpj(cnpj: str) -> str:
    """Formata CNPJ para exibição: XX.XXX.XXX/XXXX-XX"""
    c = limpar_cnpj(cnpj)
    if len(c) != 14:
        return cnpj
    return f"{c[:2]}.{c[2:5]}.{c[5:8]}/{c[8:12]}-{c[12:]}"


def formatar_cpf(cpf: str) -> str:
    """Formata CPF mascarado para exibição: ***.XXX.XXX-**"""
    c = re.sub(r"\D", "", cpf)
    if len(c) >= 11:
        return f"***.{c[3:6]}.{c[6:9]}-**"
    return cpf


def consultar_cnpj(cnpj: str) -> Optional[dict]:
    """
    Consulta dados cadastrais de um CNPJ na API OpenCNPJ.
    Retorna dict com dados completos ou None em caso de erro.
    """
    cnpj_limpo = limpar_cnpj(cnpj)
    if len(cnpj_limpo) != 14:
        print(f"  [!] CNPJ inválido: {cnpj}")
        return None

    url = f"{OPENCNPJ_BASE}/{cnpj_limpo}"

    try:
        resp = requests.get(url, timeout=15)

        if resp.status_code == 200:
            return resp.json()
        elif resp.status_code == 404:
            print(f"  [!] CNPJ não encontrado: {formatar_cnpj(cnpj_limpo)}")
            return None
        elif resp.status_code == 429:
            print(f"  [!] Rate limit atingido. Aguardando 60s...")
            time.sleep(60)
            return consultar_cnpj(cnpj)  # retry
        else:
            print(f"  [!] Erro {resp.status_code} ao consultar {formatar_cnpj(cnpj_limpo)}")
            return None

    except requests.exceptions.RequestException as e:
        print(f"  [!] Erro de conexão: {e}")
        return None


def extrair_dados_empresa(dados: dict) -> dict:
    """Extrai informações relevantes da resposta da API."""
    situacao = dados.get("situacao_cadastral") or dados.get("descricao_situacao_cadastral", "")
    if isinstance(situacao, dict):
        situacao = situacao.get("descricao", str(situacao))

    # Data de abertura
    data_abertura = dados.get("data_inicio_atividade", "")

    # Calcular idade da empresa
    empresa_recente = False
    if data_abertura:
        try:
            dt = datetime.strptime(str(data_abertura)[:10], "%Y-%m-%d").date()
            dias = (date.today() - dt).days
            empresa_recente = dias < 365
        except (ValueError, TypeError):
            pass

    # CNAE principal
    cnae = dados.get("cnae_fiscal_principal") or dados.get("cnae_fiscal", {})
    if isinstance(cnae, dict):
        cnae_desc = f"{cnae.get('codigo', '')} - {cnae.get('descricao', '')}"
    else:
        cnae_desc = str(cnae)

    return {
        "cnpj": formatar_cnpj(str(dados.get("cnpj", ""))),
        "razao_social": dados.get("razao_social", "N/A"),
        "nome_fantasia": dados.get("nome_fantasia", ""),
        "situacao_cadastral": str(situacao),
        "data_abertura": str(data_abertura),
        "empresa_recente": empresa_recente,
        "cnae_principal": cnae_desc,
        "uf": dados.get("uf", dados.get("endereco", {}).get("uf", "N/A")),
        "municipio": dados.get("municipio", dados.get("endereco", {}).get("municipio", "N/A")),
        "capital_social": dados.get("capital_social", 0),
        "porte": dados.get("porte_empresa") or dados.get("porte", "N/A"),
        "natureza_juridica": dados.get("natureza_juridica", "N/A"),
    }


def extrair_socios(dados: dict) -> list[dict]:
    """Extrai lista de sócios do QSA."""
    socios_raw = dados.get("qsa") or dados.get("socios", [])
    if not socios_raw:
        return []

    socios = []
    for s in socios_raw:
        # Identificar se é PF ou PJ
        cpf_cnpj = s.get("cnpj_cpf_do_socio", "") or s.get("cpf_cnpj", "")
        nome = s.get("nome_socio", "") or s.get("nome", "")
        qualificacao = s.get("qualificacao_socio") or s.get("qualificacao", "")

        if isinstance(qualificacao, dict):
            qualificacao = qualificacao.get("descricao", str(qualificacao))

        # Determinar tipo (PF se CPF com 11 dígitos, PJ se 14)
        cpf_cnpj_limpo = re.sub(r"\D", "", str(cpf_cnpj))
        tipo = "PJ" if len(cpf_cnpj_limpo) == 14 else "PF"

        socio = {
            "nome": nome,
            "cpf_cnpj": cpf_cnpj_limpo,
            "cpf_cnpj_formatado": formatar_cnpj(cpf_cnpj_limpo) if tipo == "PJ" else formatar_cpf(cpf_cnpj_limpo),
            "tipo": tipo,
            "qualificacao": str(qualificacao),
            "data_entrada": s.get("data_entrada_sociedade", ""),
        }

        # Representante legal (quando sócio é PJ ou menor)
        rep = s.get("nome_representante", "") or s.get("representante_legal", "")
        if rep:
            socio["representante_legal"] = rep

        socios.append(socio)

    return socios


def extrair_qsa_completo(cnpj: str, nivel: int = 0, max_nivel: int = 2, visitados: set = None) -> dict:
    """
    Extrai o QSA completo de uma empresa, com recursão para sócios PJ.

    Args:
        cnpj: CNPJ da empresa
        nivel: nível atual de recursão (0 = empresa principal)
        max_nivel: profundidade máxima de recursão
        visitados: set de CNPJs já visitados (evita loops)

    Returns:
        dict com dados da empresa, sócios e sub-empresas
    """
    if visitados is None:
        visitados = set()

    cnpj_limpo = limpar_cnpj(cnpj)

    # Evitar loops
    if cnpj_limpo in visitados:
        return {"cnpj": formatar_cnpj(cnpj_limpo), "status": "já_visitado"}
    visitados.add(cnpj_limpo)

    # Rate limiting
    time.sleep(60 / OPENCNPJ_RATE_LIMIT)

    indent = "  " * nivel
    print(f"{indent}[Agent 1] Consultando CNPJ: {formatar_cnpj(cnpj_limpo)} (nível {nivel})")

    dados = consultar_cnpj(cnpj_limpo)
    if not dados:
        return {"cnpj": formatar_cnpj(cnpj_limpo), "status": "não_encontrado"}

    empresa = extrair_dados_empresa(dados)
    socios = extrair_socios(dados)
    empresa["socios"] = socios
    empresa["status"] = "ok"

    print(f"{indent}  → {empresa['razao_social']} | Situação: {empresa['situacao_cadastral']}")
    print(f"{indent}  → {len(socios)} sócio(s) encontrado(s)")

    # Recursão para sócios PJ
    if nivel < max_nivel:
        for socio in socios:
            if socio["tipo"] == "PJ" and socio["cpf_cnpj"]:
                print(f"{indent}  → Sócio PJ detectado: {socio['nome']} — investigando...")
                sub_empresa = extrair_qsa_completo(
                    socio["cpf_cnpj"],
                    nivel=nivel + 1,
                    max_nivel=max_nivel,
                    visitados=visitados,
                )
                socio["empresa_detalhes"] = sub_empresa

    return empresa


# ── Execução standalone para testes ───────────────────────────
if __name__ == "__main__":
    import json
    cnpj_teste = input("Digite o CNPJ para consulta: ")
    resultado = extrair_qsa_completo(cnpj_teste)
    print("\n" + json.dumps(resultado, indent=2, ensure_ascii=False))
