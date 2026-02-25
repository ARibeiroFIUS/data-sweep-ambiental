"""
Agent 3 — Análise de Exposição Política (PEP) e Conflitos
Verifica se sócios são:
  - Servidores públicos federais (conflito de interesses)
  - Candidatos ou ex-candidatos (TSE)
  - Doadores de campanha eleitoral
"""
import re
import requests
import time
from typing import Optional
from config import (
    SERVIDORES_ENDPOINT,
    portal_headers,
    PORTAL_RATE_LIMIT_DAY,
    PORTAL_TRANSPARENCIA_API_KEY,
)


def _limpar_doc(doc: str) -> str:
    return re.sub(r"\D", "", doc)


# ── Servidores Públicos Federais ──────────────────────────────

def verificar_servidor_federal(cpf: str, nome: str = "") -> dict:
    """
    Verifica se um CPF corresponde a servidor público federal.
    Usa a API do Portal da Transparência.
    """
    if not PORTAL_TRANSPARENCIA_API_KEY or PORTAL_TRANSPARENCIA_API_KEY == "sua_chave_aqui":
        return {
            "verificado": False,
            "motivo": "API key não configurada",
            "encontrado": False,
        }

    cpf_limpo = _limpar_doc(cpf)
    print(f"  [Agent 3] Verificando servidor federal: {nome or cpf_limpo}")

    time.sleep(60 / PORTAL_RATE_LIMIT_DAY)

    try:
        # Busca por CPF
        resp = requests.get(
            f"{SERVIDORES_ENDPOINT}/por-cpf",
            params={"cpf": cpf_limpo},
            headers=portal_headers(),
            timeout=15,
        )

        if resp.status_code == 200:
            data = resp.json()
            servidores = data if isinstance(data, list) else [data]

            if servidores and servidores[0]:
                vinculos = []
                for s in servidores:
                    if not s:
                        continue
                    vinculo = {
                        "nome": s.get("nome", ""),
                        "orgao": (
                            s.get("orgaoServidorExercicio", {}).get("nome", "")
                            or s.get("orgao_exercicio", "")
                        ),
                        "cargo": s.get("cargo", {}).get("nome", "") or s.get("descricao_cargo", ""),
                        "funcao": s.get("funcao", {}).get("nome", "") or s.get("funcao", ""),
                        "situacao": s.get("situacaoVinculo", "") or s.get("situacao_vinculo", ""),
                        "tipo_vinculo": s.get("tipoVinculo", "") or s.get("tipo_vinculo", ""),
                    }
                    vinculos.append(vinculo)

                return {
                    "verificado": True,
                    "encontrado": True,
                    "quantidade": len(vinculos),
                    "vinculos": vinculos,
                    "risco": "ALTO — Sócio é servidor público federal (possível conflito de interesses)",
                }

            return {"verificado": True, "encontrado": False}

        elif resp.status_code == 404:
            return {"verificado": True, "encontrado": False}
        elif resp.status_code == 401:
            return {"verificado": False, "motivo": "API key inválida", "encontrado": False}
        else:
            return {"verificado": False, "motivo": f"HTTP {resp.status_code}", "encontrado": False}

    except requests.exceptions.RequestException as e:
        return {"verificado": False, "motivo": str(e), "encontrado": False}


# ── Busca por nome no Portal (servidores) ─────────────────────

def buscar_servidor_por_nome(nome: str) -> dict:
    """
    Busca servidores pelo nome (útil quando CPF é mascarado).
    ATENÇÃO: Pode retornar homônimos. Use com cautela.
    """
    if not PORTAL_TRANSPARENCIA_API_KEY or PORTAL_TRANSPARENCIA_API_KEY == "sua_chave_aqui":
        return {"verificado": False, "motivo": "API key não configurada", "encontrado": False}

    print(f"  [Agent 3] Buscando servidor por nome: {nome}")
    time.sleep(60 / PORTAL_RATE_LIMIT_DAY)

    try:
        resp = requests.get(
            SERVIDORES_ENDPOINT,
            params={"nome": nome, "pagina": 1},
            headers=portal_headers(),
            timeout=15,
        )

        if resp.status_code == 200:
            data = resp.json()
            resultados = data if isinstance(data, list) else data.get("data", [])

            if resultados:
                return {
                    "verificado": True,
                    "encontrado": True,
                    "quantidade": len(resultados),
                    "aviso": "Busca por nome — pode conter homônimos",
                    "resultados": [
                        {
                            "nome": r.get("nome", ""),
                            "orgao": r.get("orgaoServidorExercicio", {}).get("nome", ""),
                            "cargo": r.get("cargo", {}).get("nome", ""),
                        }
                        for r in resultados[:5]  # limita a 5 resultados
                    ],
                }

            return {"verificado": True, "encontrado": False}

        return {"verificado": False, "motivo": f"HTTP {resp.status_code}", "encontrado": False}

    except requests.exceptions.RequestException as e:
        return {"verificado": False, "motivo": str(e), "encontrado": False}


# ── Análise PEP Completa de um Sócio ─────────────────────────

def analisar_pep_socio(cpf: str, nome: str) -> dict:
    """
    Análise completa de exposição política de um sócio.
    """
    print(f"\n  [Agent 3] ═══ Análise PEP — {nome} ═══")

    resultado = {
        "nome": nome,
        "servidor_federal": {"verificado": False, "encontrado": False},
        "flags": [],
        "nivel_exposicao": "NENHUMA",
    }

    # 1. Verificar servidor federal por CPF
    cpf_limpo = _limpar_doc(cpf)
    if len(cpf_limpo) == 11:
        resultado["servidor_federal"] = verificar_servidor_federal(cpf_limpo, nome)
        if resultado["servidor_federal"].get("encontrado"):
            resultado["flags"].append("SERVIDOR_PUBLICO_FEDERAL")
    else:
        # CPF mascarado — tentar busca por nome
        resultado["servidor_federal"] = buscar_servidor_por_nome(nome)
        if resultado["servidor_federal"].get("encontrado"):
            resultado["flags"].append("POSSIVEL_SERVIDOR_HOMONIMO")

    # Determinar nível de exposição
    if "SERVIDOR_PUBLICO_FEDERAL" in resultado["flags"]:
        resultado["nivel_exposicao"] = "ALTA"
    elif "POSSIVEL_SERVIDOR_HOMONIMO" in resultado["flags"]:
        resultado["nivel_exposicao"] = "MEDIA_VERIFICAR"
    elif any(f.startswith("CANDIDATO") for f in resultado["flags"]):
        resultado["nivel_exposicao"] = "MEDIA"

    return resultado


def analisar_pep_todos_socios(empresa: dict) -> list[dict]:
    """
    Analisa exposição PEP de todos os sócios de uma empresa.
    """
    resultados = []
    for socio in empresa.get("socios", []):
        if socio["tipo"] == "PF":
            resultado = analisar_pep_socio(socio.get("cpf_cnpj", ""), socio["nome"])
            resultados.append(resultado)
    return resultados


# ── Execução standalone ───────────────────────────────────────
if __name__ == "__main__":
    nome = input("Nome do sócio: ")
    cpf = input("CPF (ou vazio para busca por nome): ")
    resultado = analisar_pep_socio(cpf, nome)
    import json
    print(json.dumps(resultado, indent=2, ensure_ascii=False))
