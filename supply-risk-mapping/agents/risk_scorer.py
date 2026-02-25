"""
Risk Scorer — Consolidador de Risco
Recebe outputs dos Agents 1-3 e calcula um score de risco
de 0-100 para o fornecedor.
"""
from config import RISK_WEIGHTS, RISK_LEVELS


def calcular_risk_score(empresa: dict, sancoes: dict, pep_results: list[dict]) -> dict:
    """
    Calcula o risk score consolidado de um fornecedor.

    Args:
        empresa: dados do Agent 1 (QSA completo)
        sancoes: dados do Agent 2 (scan de listas restritivas)
        pep_results: dados do Agent 3 (análise PEP dos sócios)

    Returns:
        dict com score final, nível de risco e detalhamento dos flags
    """
    score = 0
    flags = []
    detalhes = []

    # ── 1. Flags da Empresa ───────────────────────────────────

    # Situação cadastral
    situacao = str(empresa.get("situacao_cadastral", "")).upper()
    if situacao and "ATIVA" not in situacao and "ATIVO" not in situacao:
        score += RISK_WEIGHTS["situacao_irregular"]
        flags.append("SITUACAO_CADASTRAL_IRREGULAR")
        detalhes.append({
            "flag": "SITUACAO_CADASTRAL_IRREGULAR",
            "peso": RISK_WEIGHTS["situacao_irregular"],
            "descricao": f"Empresa com situação: {empresa.get('situacao_cadastral')}",
            "severidade": "ALTA",
        })

    # Empresa recente (< 1 ano)
    if empresa.get("empresa_recente"):
        score += RISK_WEIGHTS["empresa_recente"]
        flags.append("EMPRESA_RECENTE")
        detalhes.append({
            "flag": "EMPRESA_RECENTE",
            "peso": RISK_WEIGHTS["empresa_recente"],
            "descricao": f"Empresa aberta há menos de 1 ano ({empresa.get('data_abertura')})",
            "severidade": "MEDIA",
        })

    # ── 2. Flags de Listas Restritivas (Empresa) ─────────────

    sancoes_empresa = sancoes.get("empresa", {})

    if sancoes_empresa.get("ceis", {}).get("encontrado"):
        score += RISK_WEIGHTS["ceis"]
        flags.append("CEIS_EMPRESA")
        n = sancoes_empresa["ceis"]["quantidade"]
        detalhes.append({
            "flag": "CEIS_EMPRESA",
            "peso": RISK_WEIGHTS["ceis"],
            "descricao": f"Empresa consta no CEIS com {n} sanção(ões)",
            "severidade": "CRITICA",
            "dados": sancoes_empresa["ceis"].get("detalhes", []),
        })

    if sancoes_empresa.get("cnep", {}).get("encontrado"):
        score += RISK_WEIGHTS["cnep"]
        flags.append("CNEP_EMPRESA")
        n = sancoes_empresa["cnep"]["quantidade"]
        detalhes.append({
            "flag": "CNEP_EMPRESA",
            "peso": RISK_WEIGHTS["cnep"],
            "descricao": f"Empresa consta no CNEP (Lei Anticorrupção) com {n} sanção(ões)",
            "severidade": "CRITICA",
            "dados": sancoes_empresa["cnep"].get("detalhes", []),
        })

    if sancoes_empresa.get("cepim", {}).get("encontrado"):
        score += RISK_WEIGHTS["cepim"]
        flags.append("CEPIM_EMPRESA")
        detalhes.append({
            "flag": "CEPIM_EMPRESA",
            "peso": RISK_WEIGHTS["cepim"],
            "descricao": "Empresa consta no CEPIM (entidade impedida)",
            "severidade": "ALTA",
        })

    # ── 3. Flags de Sócios em Listas ─────────────────────────

    for socio_scan in sancoes.get("socios", []):
        nome_socio = socio_scan.get("nome", "N/A")
        resultados = socio_scan.get("resultados", {})

        if resultados.get("ceis", {}).get("encontrado"):
            score += RISK_WEIGHTS["socio_em_lista"]
            flags.append(f"SOCIO_CEIS:{nome_socio}")
            detalhes.append({
                "flag": "SOCIO_EM_LISTA_RESTRITIVA",
                "peso": RISK_WEIGHTS["socio_em_lista"],
                "descricao": f"Sócio '{nome_socio}' encontrado no CEIS",
                "severidade": "CRITICA",
            })

        # Sócio PJ em listas
        if socio_scan.get("tipo") == "PJ":
            if resultados.get("ceis", {}).get("encontrado"):
                score += RISK_WEIGHTS["socio_em_lista"]
                flags.append(f"SOCIO_PJ_CEIS:{nome_socio}")
                detalhes.append({
                    "flag": "SOCIO_PJ_EM_LISTA",
                    "peso": RISK_WEIGHTS["socio_em_lista"],
                    "descricao": f"Sócio PJ '{nome_socio}' encontrado no CEIS",
                    "severidade": "CRITICA",
                })
            if resultados.get("cnep", {}).get("encontrado"):
                score += RISK_WEIGHTS["socio_em_lista"]
                flags.append(f"SOCIO_PJ_CNEP:{nome_socio}")
                detalhes.append({
                    "flag": "SOCIO_PJ_EM_LISTA",
                    "peso": RISK_WEIGHTS["socio_em_lista"],
                    "descricao": f"Sócio PJ '{nome_socio}' encontrado no CNEP",
                    "severidade": "CRITICA",
                })

    # ── 4. Flags PEP ─────────────────────────────────────────

    for pep in pep_results:
        nome_socio = pep.get("nome", "N/A")

        if pep.get("nivel_exposicao") == "ALTA":
            score += RISK_WEIGHTS["servidor_publico"]
            flags.append(f"SERVIDOR_PUBLICO:{nome_socio}")
            detalhes.append({
                "flag": "SERVIDOR_PUBLICO",
                "peso": RISK_WEIGHTS["servidor_publico"],
                "descricao": f"Sócio '{nome_socio}' é servidor público federal",
                "severidade": "ALTA",
                "dados": pep.get("servidor_federal", {}).get("vinculos", []),
            })

        elif pep.get("nivel_exposicao") == "MEDIA":
            score += RISK_WEIGHTS["pep"]
            flags.append(f"PEP:{nome_socio}")
            detalhes.append({
                "flag": "PEP",
                "peso": RISK_WEIGHTS["pep"],
                "descricao": f"Sócio '{nome_socio}' identificado como Pessoa Politicamente Exposta",
                "severidade": "MEDIA",
            })

        elif pep.get("nivel_exposicao") == "MEDIA_VERIFICAR":
            score += RISK_WEIGHTS["pep"] // 2  # peso reduzido — precisa confirmar
            flags.append(f"PEP_VERIFICAR:{nome_socio}")
            detalhes.append({
                "flag": "PEP_VERIFICAR",
                "peso": RISK_WEIGHTS["pep"] // 2,
                "descricao": f"Possível homônimo de servidor encontrado para '{nome_socio}' — verificar",
                "severidade": "BAIXA",
            })

    # ── 5. Flags Estruturais ──────────────────────────────────

    # Muitas empresas (sócio PJ em muitos CNPJs — possível laranja)
    socios_pj = [s for s in empresa.get("socios", []) if s.get("tipo") == "PJ"]
    if len(socios_pj) > 3:
        score += RISK_WEIGHTS["muitas_empresas"]
        flags.append("ESTRUTURA_SOCIETARIA_COMPLEXA")
        detalhes.append({
            "flag": "ESTRUTURA_SOCIETARIA_COMPLEXA",
            "peso": RISK_WEIGHTS["muitas_empresas"],
            "descricao": f"Empresa tem {len(socios_pj)} sócios PJ — estrutura complexa",
            "severidade": "MEDIA",
        })

    # ── Consolidação ──────────────────────────────────────────

    # Cap no score máximo de 100
    score = min(score, 100)

    # Determinar nível de risco
    nivel = "BAIXO"
    for label, threshold in sorted(RISK_LEVELS.items(), key=lambda x: -x[1]):
        if score >= threshold:
            nivel = label
            break

    # Cor para o dashboard
    cores = {
        "CRITICO": "#FF0000",
        "ALTO": "#FF6B35",
        "MEDIO": "#FFB800",
        "BAIXO": "#00D4AA",
    }

    return {
        "score": score,
        "nivel": nivel,
        "cor": cores.get(nivel, "#999999"),
        "total_flags": len(flags),
        "flags": flags,
        "detalhes": sorted(detalhes, key=lambda x: -x["peso"]),
        "resumo": _gerar_resumo(score, nivel, flags, empresa),
    }


def _gerar_resumo(score: int, nivel: str, flags: list, empresa: dict) -> str:
    """Gera um resumo textual do risco."""
    razao = empresa.get("razao_social", "Fornecedor")

    if nivel == "CRITICO":
        return (
            f"⛔ RISCO CRÍTICO ({score}/100) — {razao} apresenta indicadores graves. "
            f"Foram identificados {len(flags)} flag(s) de risco, incluindo presença em listas "
            f"restritivas e/ou sócios com impedimentos. RECOMENDAÇÃO: Não contratar sem "
            f"parecer jurídico detalhado e aprovação do Compliance Officer."
        )
    elif nivel == "ALTO":
        return (
            f"🔴 RISCO ALTO ({score}/100) — {razao} apresenta múltiplos indicadores de risco. "
            f"{len(flags)} flag(s) identificados. RECOMENDAÇÃO: Due diligence aprofundada "
            f"antes de prosseguir com contratação."
        )
    elif nivel == "MEDIO":
        return (
            f"🟡 RISCO MÉDIO ({score}/100) — {razao} apresenta alguns indicadores que "
            f"merecem atenção. {len(flags)} flag(s) identificados. RECOMENDAÇÃO: Monitoramento "
            f"periódico e verificação complementar dos pontos sinalizados."
        )
    else:
        return (
            f"🟢 RISCO BAIXO ({score}/100) — {razao} não apresenta indicadores significativos "
            f"de risco nas bases consultadas. RECOMENDAÇÃO: Monitoramento padrão."
        )
