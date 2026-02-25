#!/usr/bin/env python3
"""
╔══════════════════════════════════════════════════════════════╗
║         SUPPLY RISK MAPPING — Análise de Fornecedores       ║
║                   FIUS Innovation Hub                       ║
╚══════════════════════════════════════════════════════════════╝

Sistema de due diligence automatizada que cruza bases públicas
abertas do governo brasileiro para gerar scores de risco de
fornecedores a partir do CNPJ.

Uso:
    python main.py                          # modo interativo
    python main.py 00000000000000           # CNPJ direto
    python main.py --batch lista.txt        # múltiplos CNPJs
    python main.py --batch lista.txt --csv  # saída consolidada CSV
"""
import sys
import os
import json
import csv
import re
import argparse
from datetime import datetime

# Agents
from agents.qsa_extractor import extrair_qsa_completo, formatar_cnpj, limpar_cnpj
from agents.sanctions_scanner import scan_fornecedor
from agents.pep_analyzer import analisar_pep_todos_socios
from agents.risk_scorer import calcular_risk_score

# Report
from report_generator import gerar_relatorio_html, gerar_relatorio_json

from config import PORTAL_TRANSPARENCIA_API_KEY


def banner():
    print("""
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║         ▓▓▓  SUPPLY RISK MAPPING  ▓▓▓                       ║
║         Análise Automatizada de Fornecedores                 ║
║                                                              ║
║         Powered by FIUS Innovation Hub                       ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
    """)


def check_setup():
    """Verifica configuração mínima."""
    api_ok = (
        PORTAL_TRANSPARENCIA_API_KEY
        and PORTAL_TRANSPARENCIA_API_KEY != "sua_chave_aqui"
    )

    print("── Verificação de Setup ──────────────────────────────")
    print(f"  OpenCNPJ API:              ✓ Disponível (sem chave)")

    if api_ok:
        print(f"  Portal da Transparência:   ✓ Chave configurada")
    else:
        print(f"  Portal da Transparência:   ⚠ Chave NÃO configurada")
        print(f"     → CEIS/CNEP/CEPIM e servidores não serão consultados")
        print(f"     → Cadastre-se em: https://portaldatransparencia.gov.br/api-de-dados")
        print(f"     → Adicione a chave no arquivo .env")

    print("─────────────────────────────────────────────────────\n")
    return api_ok


def analisar_fornecedor(cnpj: str, api_ok: bool = False, verbose: bool = True) -> dict:
    """
    Pipeline completo de análise de um fornecedor.

    Args:
        cnpj: CNPJ do fornecedor
        api_ok: se a API do Portal da Transparência está configurada
        verbose: se deve imprimir progresso no terminal

    Returns:
        dict com todos os resultados e o risk score
    """
    cnpj_limpo = limpar_cnpj(cnpj)

    if verbose:
        print(f"\n{'='*60}")
        print(f"  ANALISANDO FORNECEDOR: {formatar_cnpj(cnpj_limpo)}")
        print(f"  Início: {datetime.now().strftime('%H:%M:%S')}")
        print(f"{'='*60}")

    # ── Agent 1: Extração do QSA ──────────────────────────────
    if verbose:
        print(f"\n▶ FASE 1/4 — Extração do QSA (Quadro Societário)")
    empresa = extrair_qsa_completo(cnpj_limpo)

    if empresa.get("status") != "ok":
        print(f"\n  ✗ Não foi possível obter dados do CNPJ {formatar_cnpj(cnpj_limpo)}")
        return {"status": "erro", "motivo": empresa.get("status", "desconhecido")}

    # ── Agent 2: Scan de Listas Restritivas ───────────────────
    sancoes = {"empresa": {}, "socios": []}
    if api_ok:
        if verbose:
            print(f"\n▶ FASE 2/4 — Scan de Listas Restritivas (CEIS/CNEP/CEPIM)")
        sancoes = scan_fornecedor(empresa)
    else:
        if verbose:
            print(f"\n▶ FASE 2/4 — Scan de Listas Restritivas (PULADO — API não configurada)")

    # ── Agent 3: Análise PEP ──────────────────────────────────
    pep_results = []
    if api_ok:
        if verbose:
            print(f"\n▶ FASE 3/4 — Análise de Exposição Política (PEP)")
        pep_results = analisar_pep_todos_socios(empresa)
    else:
        if verbose:
            print(f"\n▶ FASE 3/4 — Análise PEP (PULADO — API não configurada)")

    # ── Risk Scorer: Consolidação ─────────────────────────────
    if verbose:
        print(f"\n▶ FASE 4/4 — Cálculo do Risk Score")
    risk = calcular_risk_score(empresa, sancoes, pep_results)

    # ── Gerar Relatórios ──────────────────────────────────────
    html_path = gerar_relatorio_html(empresa, risk, api_ok)
    json_path = gerar_relatorio_json(empresa, sancoes, pep_results, risk)

    if verbose:
        print(f"\n{'='*60}")
        print(f"  RESULTADO FINAL")
        print(f"{'='*60}")
        print(f"  Empresa:     {empresa['razao_social']}")
        print(f"  CNPJ:        {empresa['cnpj']}")
        print(f"  Situação:    {empresa['situacao_cadastral']}")
        print(f"  Sócios:      {len(empresa.get('socios', []))}")
        print(f"  ─────────────────────────────────")
        print(f"  RISK SCORE:  {risk['score']}/100")
        print(f"  NÍVEL:       {risk['nivel']}")
        print(f"  FLAGS:       {risk['total_flags']}")
        print(f"  ─────────────────────────────────")
        print(f"  {risk['resumo']}")
        print(f"  ─────────────────────────────────")
        print(f"  📄 Relatório HTML: {html_path}")
        print(f"  📊 Relatório JSON: {json_path}")
        print(f"  Fim: {datetime.now().strftime('%H:%M:%S')}")
        print(f"{'='*60}\n")

    return {
        "status": "ok",
        "empresa": empresa,
        "sancoes": sancoes,
        "pep": pep_results,
        "risk": risk,
        "relatorios": {
            "html": html_path,
            "json": json_path,
        },
    }


def modo_batch(arquivo: str, api_ok: bool, gerar_csv: bool = False):
    """
    Analisa múltiplos CNPJs a partir de um arquivo texto (um CNPJ por linha).
    """
    if not os.path.exists(arquivo):
        print(f"  ✗ Arquivo não encontrado: {arquivo}")
        return

    with open(arquivo, "r") as f:
        cnpjs = [limpar_cnpj(line.strip()) for line in f if line.strip()]

    print(f"\n  Modo batch: {len(cnpjs)} CNPJ(s) para analisar\n")
    resultados = []

    for i, cnpj in enumerate(cnpjs, 1):
        print(f"\n  ┌─ [{i}/{len(cnpjs)}] ─────────────────────────────────────")
        resultado = analisar_fornecedor(cnpj, api_ok)
        resultados.append(resultado)
        print(f"  └──────────────────────────────────────────────────\n")

    # Gerar CSV consolidado
    if gerar_csv and resultados:
        csv_path = os.path.join("reports", f"batch_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv")
        os.makedirs("reports", exist_ok=True)

        with open(csv_path, "w", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            writer.writerow([
                "CNPJ", "Razão Social", "Situação", "Qtd Sócios",
                "Risk Score", "Nível", "Flags", "Relatório HTML",
            ])
            for r in resultados:
                if r.get("status") == "ok":
                    emp = r["empresa"]
                    risk = r["risk"]
                    writer.writerow([
                        emp.get("cnpj", ""),
                        emp.get("razao_social", ""),
                        emp.get("situacao_cadastral", ""),
                        len(emp.get("socios", [])),
                        risk.get("score", 0),
                        risk.get("nivel", "N/A"),
                        "; ".join(risk.get("flags", [])),
                        r.get("relatorios", {}).get("html", ""),
                    ])

        print(f"\n  📊 CSV consolidado: {csv_path}")

    # Resumo
    print(f"\n{'='*60}")
    print(f"  RESUMO DO BATCH")
    print(f"{'='*60}")
    for r in resultados:
        if r.get("status") == "ok":
            emp = r["empresa"]
            risk = r["risk"]
            cor_emoji = {"CRITICO": "⛔", "ALTO": "🔴", "MEDIO": "🟡", "BAIXO": "🟢"}.get(risk["nivel"], "⚪")
            print(f"  {cor_emoji} {emp['cnpj']} | {risk['score']:>3}/100 {risk['nivel']:<8} | {emp['razao_social'][:40]}")
        else:
            print(f"  ✗ Erro ao processar CNPJ")
    print(f"{'='*60}\n")


def main():
    parser = argparse.ArgumentParser(
        description="Supply Risk Mapping — Análise de Fornecedores",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Exemplos:
  python main.py                          # modo interativo
  python main.py 00000000000000           # CNPJ direto
  python main.py --batch lista.txt        # múltiplos CNPJs
  python main.py --batch lista.txt --csv  # com CSV consolidado
        """,
    )
    parser.add_argument("cnpj", nargs="?", help="CNPJ do fornecedor (14 dígitos)")
    parser.add_argument("--batch", metavar="ARQUIVO", help="Arquivo com CNPJs (um por linha)")
    parser.add_argument("--csv", action="store_true", help="Gerar CSV consolidado (modo batch)")

    args = parser.parse_args()

    banner()
    api_ok = check_setup()

    if args.batch:
        modo_batch(args.batch, api_ok, gerar_csv=args.csv)
    elif args.cnpj:
        analisar_fornecedor(args.cnpj, api_ok)
    else:
        # Modo interativo
        while True:
            cnpj = input("\n  Digite o CNPJ do fornecedor (ou 'sair'): ").strip()
            if cnpj.lower() in ("sair", "exit", "q", "quit"):
                print("\n  Até mais! 👋\n")
                break
            if not cnpj:
                continue
            analisar_fornecedor(cnpj, api_ok)


if __name__ == "__main__":
    main()
