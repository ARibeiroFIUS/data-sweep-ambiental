"""
Agent 2 — Scanner de Listas Restritivas
Verifica CNPJ e CPFs de sócios contra:
  - CEIS (Empresas Inidôneas e Suspensas)
  - CNEP (Empresas Punidas — Lei Anticorrupção)
  - CEPIM (Entidades Impedidas)
  - Lista de Trabalho Escravo (quando disponível via download)
"""
import re
import requests
import time
from typing import Optional
from config import (
    CEIS_ENDPOINT,
    CNEP_ENDPOINT,
    CEPIM_ENDPOINT,
    portal_headers,
    PORTAL_RATE_LIMIT_DAY,
    PORTAL_TRANSPARENCIA_API_KEY,
)


def _limpar_doc(doc: str) -> str:
    return re.sub(r"\D", "", doc)


def _check_api_key():
    """Verifica se a chave da API está configurada."""
    if not PORTAL_TRANSPARENCIA_API_KEY or PORTAL_TRANSPARENCIA_API_KEY == "sua_chave_aqui":
        print("  [!] AVISO: Chave da API do Portal da Transparência não configurada.")
        print("      Cadastre-se em: https://portaldatransparencia.gov.br/api-de-dados")
        print("      e adicione sua chave no arquivo .env")
        return False
    return True


def _consultar_lista(endpoint: str, params: dict, nome_lista: str) -> list[dict]:
    """
    Consulta genérica contra uma lista do Portal da Transparência.
    Retorna lista de matches encontrados.
    """
    if not _check_api_key():
        return []

    try:
        # Rate limiting
        time.sleep(60 / PORTAL_RATE_LIMIT_DAY)

        resp = requests.get(
            endpoint,
            params=params,
            headers=portal_headers(),
            timeout=15,
        )

        if resp.status_code == 200:
            data = resp.json()
            if isinstance(data, list):
                return data
            elif isinstance(data, dict):
                # Algumas respostas vêm paginadas
                return data.get("data", data.get("registros", [data]))
            return []

        elif resp.status_code == 401:
            print(f"  [!] Chave API inválida para {nome_lista}")
            return []
        elif resp.status_code == 429:
            print(f"  [!] Rate limit no Portal da Transparência. Aguardando 60s...")
            time.sleep(60)
            return _consultar_lista(endpoint, params, nome_lista)
        else:
            print(f"  [!] Erro {resp.status_code} consultando {nome_lista}")
            return []

    except requests.exceptions.RequestException as e:
        print(f"  [!] Erro de conexão com {nome_lista}: {e}")
        return []


# ── CEIS — Cadastro de Empresas Inidôneas e Suspensas ─────────

def consultar_ceis_cnpj(cnpj: str) -> dict:
    """Verifica se o CNPJ está no CEIS."""
    cnpj_limpo = _limpar_doc(cnpj)
    print(f"  [Agent 2] Verificando CEIS para CNPJ {cnpj_limpo[:2]}...{cnpj_limpo[-2:]}")

    resultados = _consultar_lista(
        CEIS_ENDPOINT,
        {"cnpjSancionado": cnpj_limpo, "pagina": 1},
        "CEIS",
    )

    matches = []
    for r in resultados:
        matches.append({
            "tipo_sancao": r.get("tipoSancao", {}).get("descricaoResumida", "N/A"),
            "orgao_sancionador": r.get("orgaoSancionador", {}).get("nome", "N/A"),
            "data_inicio": r.get("dataInicioSancao", ""),
            "data_fim": r.get("dataFimSancao", ""),
            "fundamentacao": r.get("fundamentacao", {}).get("descricao", "N/A"),
        })

    return {
        "lista": "CEIS",
        "encontrado": len(matches) > 0,
        "quantidade": len(matches),
        "detalhes": matches,
    }


def consultar_ceis_cpf(cpf: str, nome: str = "") -> dict:
    """Verifica se o CPF do sócio está no CEIS (como pessoa sancionada)."""
    cpf_limpo = _limpar_doc(cpf)
    print(f"  [Agent 2] Verificando CEIS para CPF ***{cpf_limpo[3:9]}***")

    # A API CEIS permite busca por CPF de pessoa sancionada
    resultados = _consultar_lista(
        CEIS_ENDPOINT,
        {"cpfSancionado": cpf_limpo, "pagina": 1},
        "CEIS (CPF)",
    )

    matches = []
    for r in resultados:
        matches.append({
            "tipo_sancao": r.get("tipoSancao", {}).get("descricaoResumida", "N/A"),
            "orgao_sancionador": r.get("orgaoSancionador", {}).get("nome", "N/A"),
            "data_inicio": r.get("dataInicioSancao", ""),
            "data_fim": r.get("dataFimSancao", ""),
        })

    return {
        "lista": "CEIS",
        "encontrado": len(matches) > 0,
        "quantidade": len(matches),
        "detalhes": matches,
    }


# ── CNEP — Cadastro Nacional de Empresas Punidas ──────────────

def consultar_cnep_cnpj(cnpj: str) -> dict:
    """Verifica se o CNPJ está no CNEP (Lei Anticorrupção 12.846/2013)."""
    cnpj_limpo = _limpar_doc(cnpj)
    print(f"  [Agent 2] Verificando CNEP para CNPJ {cnpj_limpo[:2]}...{cnpj_limpo[-2:]}")

    resultados = _consultar_lista(
        CNEP_ENDPOINT,
        {"cnpjSancionado": cnpj_limpo, "pagina": 1},
        "CNEP",
    )

    matches = []
    for r in resultados:
        matches.append({
            "tipo_sancao": r.get("tipoSancao", {}).get("descricaoResumida", "N/A"),
            "orgao_sancionador": r.get("orgaoSancionador", {}).get("nome", "N/A"),
            "data_inicio": r.get("dataInicioSancao", ""),
            "data_fim": r.get("dataFimSancao", ""),
            "valor_multa": r.get("valorMulta", 0),
        })

    return {
        "lista": "CNEP",
        "encontrado": len(matches) > 0,
        "quantidade": len(matches),
        "detalhes": matches,
    }


# ── CEPIM — Entidades Privadas Sem Fins Lucrativos Impedidas ──

def consultar_cepim_cnpj(cnpj: str) -> dict:
    """Verifica se o CNPJ está no CEPIM."""
    cnpj_limpo = _limpar_doc(cnpj)
    print(f"  [Agent 2] Verificando CEPIM para CNPJ {cnpj_limpo[:2]}...{cnpj_limpo[-2:]}")

    resultados = _consultar_lista(
        CEPIM_ENDPOINT,
        {"cnpjSancionado": cnpj_limpo, "pagina": 1},
        "CEPIM",
    )

    matches = []
    for r in resultados:
        matches.append({
            "motivo": r.get("motivoImpedimento", "N/A"),
            "orgao": r.get("orgaoMaximo", {}).get("nome", "N/A"),
            "convenio": r.get("convenio", "N/A"),
        })

    return {
        "lista": "CEPIM",
        "encontrado": len(matches) > 0,
        "quantidade": len(matches),
        "detalhes": matches,
    }


# ── Scan Completo ─────────────────────────────────────────────

def scan_completo_cnpj(cnpj: str) -> dict:
    """
    Executa verificação completa de um CNPJ contra todas as listas.
    Retorna dict com resultados de cada lista.
    """
    print(f"\n  [Agent 2] ═══ Scan de Listas Restritivas — CNPJ ═══")
    return {
        "ceis": consultar_ceis_cnpj(cnpj),
        "cnep": consultar_cnep_cnpj(cnpj),
        "cepim": consultar_cepim_cnpj(cnpj),
    }


def scan_completo_cpf(cpf: str, nome: str = "") -> dict:
    """
    Executa verificação completa de um CPF (sócio) contra listas.
    """
    print(f"\n  [Agent 2] ═══ Scan de Listas Restritivas — Sócio: {nome} ═══")
    return {
        "ceis": consultar_ceis_cpf(cpf, nome),
    }


def scan_fornecedor(empresa: dict) -> dict:
    """
    Scan completo de um fornecedor (empresa + todos os sócios).

    Args:
        empresa: dict retornado pelo Agent 1 (extrair_qsa_completo)

    Returns:
        dict com resultados para a empresa e cada sócio
    """
    cnpj = re.sub(r"\D", "", empresa.get("cnpj", ""))
    resultados = {
        "empresa": scan_completo_cnpj(cnpj),
        "socios": [],
    }

    for socio in empresa.get("socios", []):
        if socio["tipo"] == "PF" and socio.get("cpf_cnpj"):
            resultado_socio = scan_completo_cpf(socio["cpf_cnpj"], socio["nome"])
            resultados["socios"].append({
                "nome": socio["nome"],
                "cpf_cnpj": socio.get("cpf_cnpj_formatado", socio["cpf_cnpj"]),
                "resultados": resultado_socio,
            })
        elif socio["tipo"] == "PJ" and socio.get("cpf_cnpj"):
            resultado_pj = scan_completo_cnpj(socio["cpf_cnpj"])
            resultados["socios"].append({
                "nome": socio["nome"],
                "cpf_cnpj": socio.get("cpf_cnpj_formatado", socio["cpf_cnpj"]),
                "tipo": "PJ",
                "resultados": resultado_pj,
            })

    return resultados


# ── Execução standalone para testes ───────────────────────────
if __name__ == "__main__":
    cnpj_teste = input("CNPJ para verificar nas listas: ")
    resultado = scan_completo_cnpj(cnpj_teste)
    import json
    print(json.dumps(resultado, indent=2, ensure_ascii=False))
