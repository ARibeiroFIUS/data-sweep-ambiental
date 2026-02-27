# Supply Risk Mapping — Especificação Técnica Completa

## Sistema Multiagente de Due Diligence Automatizada

### FIUS Innovation Hub | v2.0

---

## Sumário

1. Visão Geral do Sistema
2. O Problema do CPF Mascarado
3. Arquitetura de Dados: O Que Temos e O Que Não Temos
4. Estratégia de Identificação: Nome como Chave Primária
5. Motor de Desambiguação de Homônimos
6. Modelo de Dados (Entidades, Arestas, Findings)
7. Arquitetura dos Multiagentes
8. Agent 0 — Reverse Lookup de Sócios
9. Agent 1 — QSA Deep Explorer
10. Agent 2 — Sanctions Scanner
11. Agent 3 — PEP & Conflict Analyzer
12. Agent 4 — Contratos & Licitações
13. Agent 5 — Judicial & Dívidas
14. Agent 6 — Doações Eleitorais
15. Agent 7 — Network Analyzer (Meta-Agent)
16. Orquestrador (Investigation Loop)
17. Risk Scorer (Graph-Aware)
18. Geração de Relatório
19. UX: Níveis de Confiança no Frontend
20. Fontes de Dados (APIs e Downloads)
21. Infraestrutura e Deploy
22. Base Legal e LGPD
23. Roadmap de Implementação

---

## 1. Visão Geral do Sistema

O Supply Risk Mapping é um sistema de due diligence automatizada de fornecedores que, a partir de um CNPJ, executa uma investigação em profundidade cruzando dezenas de bases públicas brasileiras.

O diferencial do sistema é que ele não para na consulta superficial. Ele descobre os sócios do fornecedor, descobre as OUTRAS empresas desses sócios, verifica cada uma contra listas restritivas, identifica conexões políticas, contratos governamentais, processos judiciais e doações eleitorais — expandindo o grafo de investigação até esgotar todos os leads.

### Fluxo simplificado

```
CNPJ → Sócios → Outras empresas dos sócios → Sócios dessas empresas → ...
  ↓        ↓              ↓                          ↓
Listas   Listas        Listas                     Listas
PEP      PEP           PEP                        PEP
Contratos Contratos    Contratos                  Contratos
  ...      ...          ...                        ...
                    ↓
            Grafo completo de relacionamentos
                    ↓
            Risk Score consolidado
                    ↓
            Relatório com níveis de confiança
```

### Princípio central: "Scrape until dry"

O sistema mantém uma fila de investigação. Cada agent que roda pode gerar novos leads (CPFs, CNPJs, nomes) que retornam para a fila. O loop só para quando:

- A fila está vazia (todos os leads foram investigados), OU
- O limite de entidades foi atingido (`MAX_ENTITIES = 100`), OU
- O timeout foi atingido (`MAX_TIME = 300s`), OU
- A profundidade máxima foi atingida (`MAX_DEPTH = 3`)

---

## 2. O Problema do CPF Mascarado

### A realidade dos dados públicos da Receita Federal

A Receita Federal disponibiliza dados abertos do CNPJ mensalmente. No campo de sócios (QSA), o CPF vem **mascarado na fonte**:

```
Formato publicado:  ***718.468-**
Dígitos disponíveis: _ _ _ 7 1 8 4 6 8 _ _
                         └── 6 dígitos do meio ──┘
```

Isso não é uma limitação da API. É como a Receita Federal publica. **Nenhuma API gratuita fornece o CPF completo** porque o dado simplesmente não existe nos dados abertos.

### Impacto no sistema

Sem CPF completo, não é possível:

- Fazer busca direta por CPF nas listas restritivas (CEIS, CNEP, etc.)
- Fazer reverse lookup CPF → empresas via API
- Confirmar identidade com 100% de certeza automaticamente

### O que TEMOS para cada sócio PF

| Campo | Disponível? | Exemplo | Fonte |
|-------|------------|---------|-------|
| Nome completo | Sim, sempre | JOÃO CARLOS PEREIRA DA SILVA | QSA (Receita) |
| CPF parcial (6 dígitos) | Sim, sempre | 718468 | QSA (Receita) |
| Faixa etária | Às vezes | 41-50 | Base RF completa |
| Data de entrada | Sim | 2019-03-15 | QSA (Receita) |
| Qualificação | Sim | Sócio-Administrador | QSA (Receita) |
| Endereço pessoal | Não | — | Não disponível |
| Endereço da EMPRESA | Sim | Rua X, São Paulo-SP | QSA (Receita) |

---

## 3. Arquitetura de Dados

### Dados do sócio (saída do Agent 1)

```python
@dataclass
class SocioIdentity:
    """Identidade de um sócio extraída do QSA."""

    # ── Identificadores ───────────────────────────
    nome_completo: str              # "JOÃO CARLOS PEREIRA DA SILVA"
    cpf_parcial: str                # "718468" (6 dígitos do meio)
    tipo: str                       # "PF" ou "PJ"

    # ── Chave composta de busca ───────────────────
    search_key: str                 # "718468_JOAO CARLOS PEREIRA DA SILVA"

    # ── Contexto da sociedade ─────────────────────
    cnpj_empresa: str               # CNPJ onde é sócio
    razao_social_empresa: str       # Razão social da empresa
    qualificacao: str               # "Sócio-Administrador"
    data_entrada: str               # "2019-03-15"

    # ── Localização (da empresa, não da pessoa) ───
    uf_empresa: str                 # "SP"
    municipio_empresa: str          # "SAO PAULO"
    endereco_empresa: str           # "RUA X, 100"

    # ── Metadados ─────────────────────────────────
    faixa_etaria: str | None        # "41-50" (quando disponível)
    nome_normalizado: str           # "JOAO CARLOS PEREIRA DA SILVA" (sem acentos, upper)
    nome_partes: int                # 5 (quantidade de palavras no nome)
    nome_raridade: str              # "RARO" | "MEDIO" | "COMUM"
    depth: int                      # Distância do CNPJ original no grafo
```

### Cálculo de raridade do nome

```python
# Nomes muito comuns no Brasil (top combinações)
# Fonte: IBGE Nomes + análise estatística
SOBRENOMES_COMUNS = {
    "SILVA", "SANTOS", "SOUZA", "OLIVEIRA", "PEREIRA",
    "FERREIRA", "ALMEIDA", "COSTA", "RODRIGUES", "LIMA",
    "GOMES", "RIBEIRO", "MARTINS", "CARVALHO", "ARAUJO",
}

PRIMEIROS_NOMES_COMUNS = {
    "JOSE", "MARIA", "JOAO", "ANTONIO", "FRANCISCO",
    "ANA", "CARLOS", "PAULO", "PEDRO", "LUCAS",
    "MARCOS", "LUIZ", "FERNANDA", "ADRIANA", "ROBERTO",
}

def calcular_raridade(nome: str) -> str:
    """
    Estima a raridade de um nome completo.

    Retorna:
        "MUITO_COMUM": Nome + sobrenome nos top lists, <= 2 partes
        "COMUM": Nome ou sobrenome nos top lists, <= 3 partes
        "MEDIO": Parcialmente nos top lists, 3-4 partes
        "RARO": Nenhum componente nos top lists, ou 5+ partes
    """
    partes = nome.upper().split()
    primeiro = partes[0] if partes else ""
    ultimo = partes[-1] if partes else ""
    qtd_partes = len(partes)

    primeiro_comum = primeiro in PRIMEIROS_NOMES_COMUNS
    ultimo_comum = ultimo in SOBRENOMES_COMUNS

    if primeiro_comum and ultimo_comum and qtd_partes <= 2:
        return "MUITO_COMUM"      # "JOSE SILVA" — milhões de pessoas
    elif (primeiro_comum or ultimo_comum) and qtd_partes <= 3:
        return "COMUM"            # "JOSE CARLOS SILVA"
    elif qtd_partes >= 5:
        return "RARO"             # "JOAO CARLOS PEREIRA DA SILVA NETO"
    elif not primeiro_comum and not ultimo_comum:
        return "RARO"             # "DAGOBERTO KREUTZFELDT"
    else:
        return "MEDIO"            # Caso geral
```

---

## 4. Estratégia de Identificação

### Regra de ouro: NOME é a chave primária de busca, CPF parcial é o validador

```
┌─────────────────────────────────────────────────────────────┐
│                                                              │
│   BUSCAR por NOME COMPLETO em todas as bases                │
│                     │                                        │
│                     ▼                                        │
│   Para cada resultado encontrado:                            │
│                     │                                        │
│                     ▼                                        │
│   A base retornou CPF (parcial ou completo)?                │
│     │                                                        │
│     ├── SIM → Extrair 6 dígitos do meio                     │
│     │          │                                             │
│     │          ├── Batem com o CPF parcial do sócio?         │
│     │          │    ├── SIM → Prosseguir (forte evidência)   │
│     │          │    └── NÃO → DESCARTAR (homônimo certo)    │
│     │          │                                             │
│     └── NÃO → Prosseguir com scoring de confiança           │
│                (sem poder descartar nem confirmar por CPF)   │
│                                                              │
│                     │                                        │
│                     ▼                                        │
│   Aplicar Motor de Desambiguação (seção 5)                  │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Como cada base aceita busca

| Base | Busca por nome? | Retorna CPF? | Endpoint |
|------|----------------|-------------|----------|
| CEIS | Sim (`nomeSancionado`) | Sim (parcial) | Portal Transparência API |
| CNEP | Sim (`nomeSancionado`) | Sim (parcial) | Portal Transparência API |
| CEPIM | Sim (`nomeEntidade`) | Às vezes | Portal Transparência API |
| CEAF | Sim (`nome`) | Sim (parcial) | Portal Transparência API |
| Servidores Federais | Sim (`nome`) | Depende do endpoint | Portal Transparência API |
| TSE Candidaturas | Sim (nome no CSV) | Sim (completo no CSV) | Download TSE |
| TSE Filiações | Sim (nome no CSV) | Não | Download TSE |
| TSE Doações | Sim (nome no CSV) | Sim (parcial) | Download TSE |
| DataJud (CNJ) | Sim (nome da parte) | Não | API DataJud |
| PGFN Dívida Ativa | Por CNPJ apenas | — | Consulta online |
| Casa dos Dados | Sim (`nome_socio`) | Sim (6 dígitos) | API Casa dos Dados |
| Trabalho Escravo | Nome no CSV | Sim (CNPJ) | Download Portal |
| IBAMA | Por CNPJ/CPF | — | Download |
| Base local RF | Sim (nome + CPF parcial) | Sim (6 dígitos) | SQLite/PostgreSQL |

---

## 5. Motor de Desambiguação de Homônimos

### Visão geral

O motor de desambiguação é o componente mais crítico do sistema. Ele recebe um par (sócio do QSA, match encontrado em alguma base) e retorna um **nível de confiança** de que se trata da mesma pessoa.

### Estrutura do match

```python
@dataclass
class IdentityMatch:
    """
    Resultado de uma busca por nome em qualquer base,
    pareado com o sócio original do QSA.
    """

    # ── Dados do sócio (o que buscamos) ───────────
    socio: SocioIdentity

    # ── Dados do match (o que encontramos) ────────
    nome_encontrado: str
    cpf_encontrado: str | None      # pode não vir
    uf_encontrada: str | None
    municipio_encontrado: str | None
    base_origem: str                 # "CEIS", "SERVIDORES", "TSE", etc.
    dados_brutos: dict               # payload completo da API

    # ── Resultado da desambiguação ────────────────
    confianca: float = 0.0           # 0.0 a 1.0
    nivel: str = "NAO_AVALIADO"      # ver tabela abaixo
    evidencias: list[str] = field(default_factory=list)
    motivo_descarte: str | None = None
```

### Níveis de confiança

| Nível | Score | Significado | Ação no relatório |
|-------|-------|-------------|-------------------|
| `CONFIRMADO` | >= 0.85 | Identidade confirmada com alta confiança | Flag firme, cor sólida |
| `PROVAVEL` | 0.60 — 0.84 | Muito provavelmente a mesma pessoa | Flag com ressalva "Verificar" |
| `POSSIVEL` | 0.40 — 0.59 | Pode ser a mesma pessoa, evidência insuficiente | Flag discreto + botão "Verificar manualmente" |
| `DESCARTADO` | < 0.40 | Provavelmente homônimo | Não aparece no relatório |
| `HOMONIMO_CERTO` | — | CPF parcial divergente, homônimo confirmado | Descartado silenciosamente |

### Algoritmo completo de scoring

```python
def calcular_confianca(socio: SocioIdentity, match: IdentityMatch) -> IdentityMatch:
    """
    Algoritmo completo de desambiguação.

    O scoring funciona em camadas. Cada camada adiciona ou subtrai
    confiança. A qualquer momento, o match pode ser descartado
    definitivamente (quando CPF parcial diverge).

    Retorna o match com confiança e nível calculados.
    """
    score = 0.0
    evidencias = []

    # ══════════════════════════════════════════════════════
    # CAMADA 1: NOME
    # ══════════════════════════════════════════════════════

    nome_socio = normalizar(socio.nome_completo)
    nome_match = normalizar(match.nome_encontrado)

    if nome_socio == nome_match:
        # Nome completo exato
        score += 0.40
        evidencias.append(f"Nome completo exato: {nome_socio}")

    elif _primeiro_ultimo_match(nome_socio, nome_match):
        # Primeiro e último nome batem, falta do meio
        # Ex: "JOAO SILVA" vs "JOAO CARLOS DA SILVA"
        score += 0.25
        evidencias.append(
            f"Nome parcial: primeiro e último batem "
            f"({nome_socio} ~ {nome_match})"
        )

    elif _primeiro_nome_match(nome_socio, nome_match):
        # Só o primeiro nome bate — fraco demais
        score += 0.10
        evidencias.append(f"Apenas primeiro nome bate")

    else:
        # Nomes não são compatíveis — descartar
        match.confianca = 0.0
        match.nivel = "DESCARTADO"
        match.motivo_descarte = (
            f"Nomes incompatíveis: '{nome_socio}' vs '{nome_match}'"
        )
        return match


    # ══════════════════════════════════════════════════════
    # CAMADA 2: CPF PARCIAL (o filtro mais poderoso)
    # ══════════════════════════════════════════════════════

    if match.cpf_encontrado:
        cpf_meio_match = extrair_6_digitos(match.cpf_encontrado)
        cpf_meio_socio = socio.cpf_parcial

        if cpf_meio_match and cpf_meio_socio:
            if cpf_meio_match == cpf_meio_socio:
                # CPF parcial bate — evidência muito forte
                score += 0.45
                evidencias.append(
                    f"CPF parcial confirmado: "
                    f"***{cpf_meio_socio}** (6 dígitos batem)"
                )

            else:
                # CPF parcial DIVERGE — homônimo CERTO
                # Este é o caso mais claro: mesma pessoa não pode
                # ter dois CPFs diferentes
                match.confianca = 0.0
                match.nivel = "HOMONIMO_CERTO"
                match.motivo_descarte = (
                    f"CPF divergente: sócio=***{cpf_meio_socio}** "
                    f"vs match=***{cpf_meio_match}**"
                )
                return match

        # Se não conseguiu extrair os 6 dígitos (formato inesperado),
        # não soma nem descarta — prossegue sem essa evidência

    else:
        # Base não retornou CPF
        # Não pode confirmar nem descartar por CPF
        evidencias.append("CPF não disponível na base de origem")


    # ══════════════════════════════════════════════════════
    # CAMADA 3: LOCALIZAÇÃO GEOGRÁFICA
    # ══════════════════════════════════════════════════════

    # Usamos o endereço da EMPRESA do sócio (não o pessoal,
    # que não temos) como proxy de localização.

    if match.uf_encontrada and socio.uf_empresa:
        if normalizar(match.uf_encontrada) == normalizar(socio.uf_empresa):
            score += 0.08
            evidencias.append(f"Mesma UF: {socio.uf_empresa}")
        else:
            # UF diferente não descarta (pessoa pode atuar em outro estado)
            # mas penaliza levemente
            score -= 0.03
            evidencias.append(
                f"UF diferente: sócio em {socio.uf_empresa}, "
                f"match em {match.uf_encontrada}"
            )

    if match.municipio_encontrado and socio.municipio_empresa:
        if _municipio_match(
            match.municipio_encontrado,
            socio.municipio_empresa
        ):
            score += 0.08
            evidencias.append(f"Mesmo município: {socio.municipio_empresa}")


    # ══════════════════════════════════════════════════════
    # CAMADA 4: FAIXA ETÁRIA (quando disponível)
    # ══════════════════════════════════════════════════════

    # A base da RF tem faixa etária para alguns sócios.
    # Se o match também tiver idade/faixa, podemos comparar.
    # Implementação futura — depende da base de dados ter esse campo.


    # ══════════════════════════════════════════════════════
    # CAMADA 5: AJUSTE POR RARIDADE DO NOME
    # ══════════════════════════════════════════════════════
    #
    # Nomes muito comuns (JOSE SILVA) têm probabilidade muito
    # maior de homônimo. Nomes raros (DAGOBERTO KREUTZFELDT)
    # quase certamente são a mesma pessoa.

    raridade = socio.nome_raridade  # calculado na extração

    multiplicadores = {
        "MUITO_COMUM": 0.65,    # Penaliza fortemente
        "COMUM":       0.80,    # Penaliza moderadamente
        "MEDIO":       1.00,    # Sem ajuste
        "RARO":        1.15,    # Bônus leve
    }

    multiplicador = multiplicadores.get(raridade, 1.0)
    score_antes = score
    score = score * multiplicador

    if multiplicador != 1.0:
        evidencias.append(
            f"Ajuste por raridade do nome ({raridade}): "
            f"{score_antes:.2f} → {score:.2f} "
            f"(multiplicador {multiplicador})"
        )


    # ══════════════════════════════════════════════════════
    # CAMADA 6: CONVERGÊNCIA ENTRE BASES (bonus)
    # ══════════════════════════════════════════════════════
    #
    # Esta camada não é calculada aqui — é calculada DEPOIS
    # que todos os agents rodaram, pelo Orchestrator.
    # Se a mesma pessoa aparece em múltiplas bases com dados
    # convergentes, a confiança de CADA match sobe.
    #
    # Ver seção "Convergência cross-agent" no Orchestrator.


    # ══════════════════════════════════════════════════════
    # DECISÃO FINAL
    # ══════════════════════════════════════════════════════

    score = max(0.0, min(score, 1.0))  # clamp 0-1

    if score >= 0.85:
        nivel = "CONFIRMADO"
    elif score >= 0.60:
        nivel = "PROVAVEL"
    elif score >= 0.40:
        nivel = "POSSIVEL"
    else:
        nivel = "DESCARTADO"

    match.confianca = score
    match.nivel = nivel
    match.evidencias = evidencias

    return match
```

### Funções auxiliares de normalização

```python
import re
from unicodedata import normalize, category

def normalizar(texto: str) -> str:
    """
    Normaliza texto para comparação:
    - Remove acentos
    - Converte para uppercase
    - Remove espaços extras
    - Remove caracteres especiais
    """
    if not texto:
        return ""
    # Remove acentos
    nfkd = normalize("NFKD", texto)
    sem_acento = "".join(c for c in nfkd if not category(c).startswith("M"))
    # Uppercase, limpa espaços
    return re.sub(r"\s+", " ", sem_acento.upper().strip())


def extrair_6_digitos(cpf: str) -> str:
    """
    Extrai os 6 dígitos do meio de qualquer formato de CPF.

    Formatos aceitos:
        12345678901       → 456789
        123.456.789-01    → 456789
        ***456.789-**     → 456789
        ***456789**       → 456789

    Retorna string com 6 dígitos ou string vazia se não conseguir.
    """
    if not cpf:
        return ""

    # Remove tudo que não é dígito ou asterisco
    limpo = re.sub(r"[^\d*]", "", str(cpf))

    # Se tem 11 dígitos puros → CPF completo
    digitos = re.sub(r"\D", "", str(cpf))
    if len(digitos) == 11:
        return digitos[3:9]

    # Se tem 6 dígitos puros → já é o parcial
    if len(digitos) == 6:
        return digitos

    # Tentar extrair do formato ***XXXXXX**
    match = re.search(r"\*{3}(\d{6})\*{2}", limpo)
    if match:
        return match.group(1)

    # Tentar extrair quaisquer 6 dígitos consecutivos
    match = re.search(r"(\d{6})", limpo)
    if match:
        return match.group(1)

    return ""


def _primeiro_ultimo_match(nome1: str, nome2: str) -> bool:
    """
    Verifica se primeiro e último nome são iguais.
    Útil para nomes com variação no "do meio".

    "JOAO SILVA" vs "JOAO CARLOS DA SILVA" → True
    "JOAO SILVA" vs "JOSE SILVA" → False
    """
    partes1 = nome1.split()
    partes2 = nome2.split()
    if len(partes1) < 2 or len(partes2) < 2:
        return False
    return partes1[0] == partes2[0] and partes1[-1] == partes2[-1]


def _primeiro_nome_match(nome1: str, nome2: str) -> bool:
    """Verifica se apenas o primeiro nome bate."""
    partes1 = nome1.split()
    partes2 = nome2.split()
    if not partes1 or not partes2:
        return False
    return partes1[0] == partes2[0]


def _municipio_match(m1: str, m2: str) -> bool:
    """
    Compara municípios com normalização.
    Lida com variações como "SAO PAULO" vs "São Paulo".
    """
    return normalizar(m1) == normalizar(m2)
```

### Convergência cross-agent (calculada pelo Orchestrator)

Depois que todos os agents rodaram para um sócio, o Orchestrator verifica se há convergência entre os resultados de diferentes bases.

```python
def aplicar_convergencia(
    socio: SocioIdentity,
    todos_matches: list[IdentityMatch]
) -> list[IdentityMatch]:
    """
    Se o mesmo nome aparece em múltiplas bases com dados
    convergentes, aumenta a confiança de todos os matches.

    Lógica:
    - 2 bases com match → +0.08 para cada match
    - 3+ bases com match → +0.15 para cada match
    - Se 2+ bases retornaram CPF parcial E todos batem → +0.20

    Isso transforma um POSSIVEL em PROVAVEL, ou um PROVAVEL
    em CONFIRMADO, quando há evidência cruzada.
    """
    # Filtrar matches não descartados
    ativos = [m for m in todos_matches if m.nivel not in ("DESCARTADO", "HOMONIMO_CERTO")]

    if len(ativos) < 2:
        return todos_matches  # sem convergência possível

    # Contar bases com match
    bases_com_match = set(m.base_origem for m in ativos)
    n_bases = len(bases_com_match)

    # Bonus por convergência
    bonus = 0.0
    motivo = ""

    if n_bases >= 3:
        bonus = 0.15
        motivo = f"Convergência forte: match em {n_bases} bases ({', '.join(bases_com_match)})"
    elif n_bases >= 2:
        bonus = 0.08
        motivo = f"Convergência moderada: match em {n_bases} bases ({', '.join(bases_com_match)})"

    # Bonus adicional: múltiplos CPFs parciais convergentes
    cpfs_encontrados = set()
    for m in ativos:
        if m.cpf_encontrado:
            cpf_meio = extrair_6_digitos(m.cpf_encontrado)
            if cpf_meio:
                cpfs_encontrados.add(cpf_meio)

    if len(cpfs_encontrados) == 1 and cpfs_encontrados.pop() == socio.cpf_parcial:
        # Múltiplas bases retornaram o mesmo CPF parcial, e bate
        bonus += 0.20
        motivo += " + CPF parcial confirmado em múltiplas bases"

    # Aplicar bonus
    if bonus > 0:
        for m in ativos:
            m.confianca = min(m.confianca + bonus, 1.0)
            m.evidencias.append(motivo)

            # Recalcular nível
            if m.confianca >= 0.85:
                m.nivel = "CONFIRMADO"
            elif m.confianca >= 0.60:
                m.nivel = "PROVAVEL"
            elif m.confianca >= 0.40:
                m.nivel = "POSSIVEL"
            else:
                m.nivel = "DESCARTADO"

    return todos_matches
```

### Tabela de cenários de desambiguação

| Cenário | Nome | CPF parcial | UF | Raridade | Score | Nível |
|---------|------|------------|-----|----------|-------|-------|
| Melhor caso | Exato (+0.40) | Bate (+0.45) | — | — | 0.85 | CONFIRMADO |
| Forte | Exato (+0.40) | Bate (+0.45) | Bate (+0.08) | — | 0.93 | CONFIRMADO |
| Bom sem CPF | Exato (+0.40) | Não disponível | Bate (+0.08) | Raro (x1.15) | 0.55 | POSSIVEL |
| Bom + convergência | Exato (+0.40) | Não disponível | Bate (+0.08) | Raro (x1.15) +conv(+0.15) | 0.70 | PROVAVEL |
| Perigoso | Exato (+0.40) | Não disponível | Diferente (-0.03) | Muito Comum (x0.65) | 0.24 | DESCARTADO |
| Homônimo certo | Exato | Diverge | — | — | 0.00 | HOMONIMO_CERTO |
| Nome parcial | Parcial (+0.25) | Bate (+0.45) | — | — | 0.70 | PROVAVEL |
| Fraco | Parcial (+0.25) | Não disponível | Diferente | Comum (x0.80) | 0.18 | DESCARTADO |

---

## 6. Modelo de Dados

### Entidades (Nós do Grafo)

```python
@dataclass
class Entity:
    """Qualquer entidade investigável no sistema."""

    id: str                    # CPF parcial + nome (PF) ou CNPJ (PJ)
    type: str                  # "PF" | "PJ"
    name: str                  # Nome completo ou razão social
    depth: int                 # Distância do CNPJ original (0 = fornecedor)
    source_agent: str          # Qual agent descobriu esta entidade
    priority: float            # 0.0 a 1.0 — prioridade na fila
    status: str                # "PENDING" | "INVESTIGATING" | "DONE"

    # Para PF:
    cpf_parcial: str = ""
    nome_raridade: str = ""
    faixa_etaria: str = ""

    # Para PJ:
    cnpj: str = ""
    situacao_cadastral: str = ""
    cnae: str = ""
    uf: str = ""
    municipio: str = ""
    endereco: str = ""
    capital_social: float = 0
    data_abertura: str = ""

    # Resultados acumulados:
    findings: list = field(default_factory=list)
    matches: list = field(default_factory=list)   # IdentityMatches
    risk_contribution: float = 0.0
```

### Arestas (Conexões)

```python
@dataclass
class Edge:
    """Conexão entre duas entidades no grafo."""

    source_id: str
    target_id: str
    relationship: str          # ver tabela abaixo
    metadata: dict = field(default_factory=dict)
    confidence: float = 1.0    # confiança nesta conexão
    source_agent: str = ""
```

**Tipos de relacionamento:**

| Relationship | De | Para | Metadata |
|---|---|---|---|
| `SOCIO_DE` | PF | PJ | qualificacao, data_entrada, data_saida |
| `ADMINISTRADOR_DE` | PF | PJ | qualificacao, data_entrada |
| `SOCIO_PJ_DE` | PJ | PJ | qualificacao |
| `MESMO_ENDERECO` | PJ | PJ | endereco |
| `MESMO_CNAE` | PJ | PJ | cnae |
| `CONTRATADO_POR` | PJ | Órgão | valor, vigencia, modalidade |
| `DOOU_PARA` | PF/PJ | Candidato | valor, ano_eleicao |
| `SERVIDOR_DE` | PF | Órgão | cargo, orgao, data |
| `PROCESSO_CONTRA` | PF/PJ | Tribunal | numero, assunto, valor |
| `SANCIONADO_EM` | PF/PJ | Lista | tipo, periodo, orgao_sancionador |

### Findings (Achados)

```python
@dataclass
class Finding:
    """Um achado de risco identificado por qualquer agent."""

    type: str                  # Código do flag (ver tabela de flags)
    severity: str              # "CRITICA" | "ALTA" | "MEDIA" | "BAIXA" | "INFO"
    title: str                 # Resumo curto para exibição
    description: str           # Descrição detalhada
    source_agent: str          # Qual agent gerou este finding
    source_base: str           # Base de dados de origem
    entity_id: str             # Entidade afetada
    confidence: float          # Nível de confiança (do motor de desambiguação)
    confidence_level: str      # "CONFIRMADO" | "PROVAVEL" | "POSSIVEL"
    evidencias: list[str]      # Lista de evidências usadas
    data: dict                 # Dados brutos
    timestamp: str             # Quando foi encontrado
    recomendacao: str          # O que o advogado deve fazer
```

**Tabela completa de flags:**

| Flag | Severidade | Peso | Agent | Descrição |
|------|-----------|------|-------|-----------|
| `CEIS_EMPRESA` | CRITICA | 35 | 2 | Empresa no CEIS |
| `CEIS_SOCIO` | CRITICA | 30 | 2 | Sócio no CEIS |
| `CNEP_EMPRESA` | CRITICA | 30 | 2 | Empresa no CNEP (Lei Anticorrupção) |
| `CNEP_SOCIO` | CRITICA | 28 | 2 | Sócio no CNEP |
| `TRABALHO_ESCRAVO` | CRITICA | 35 | 2 | Lista de trabalho escravo |
| `CEAF_SOCIO` | CRITICA | 30 | 2 | Sócio expulso da adm. federal |
| `TCU_IRREGULAR` | ALTA | 25 | 2 | Contas julgadas irregulares pelo TCU |
| `SERVIDOR_PUBLICO` | ALTA | 25 | 3 | Sócio é servidor público |
| `SERVIDOR_ORGAO_CONTRATANTE` | CRITICA | 40 | 3+4 | Sócio é servidor do órgão que contrata |
| `EX_CANDIDATO` | MEDIA | 15 | 3 | Sócio é/foi candidato |
| `FILIADO_PARTIDO` | BAIXA | 5 | 3 | Sócio filiado a partido |
| `NOMEACAO_DOU` | MEDIA | 15 | 3 | Sócio nomeado em cargo via DOU |
| `CONTRATO_GOVERNO` | INFO | 0 | 4 | Empresa tem contratos públicos |
| `DISPENSA_LICITACAO` | MEDIA | 15 | 4 | Contrato por dispensa de licitação |
| `CONCENTRACAO_ORGAO` | MEDIA | 15 | 4 | Múltiplos contratos com mesmo órgão |
| `VALOR_DESPROPORCIONAL` | ALTA | 20 | 4 | Contrato > 10x capital social |
| `PROCESSO_CRIMINAL` | ALTA | 25 | 5 | Processo criminal ativo |
| `VOLUME_TRABALHISTAS` | MEDIA | 10 | 5 | > 10 processos trabalhistas |
| `DIVIDA_ATIVA` | MEDIA | 15 | 5 | Inscrito na dívida ativa |
| `EXECUCAO_FISCAL` | ALTA | 20 | 5 | Execução fiscal em andamento |
| `DOOU_PARA_CONTRATANTE` | ALTA | 25 | 6 | Doou para político ligado ao contratante |
| `VOLUME_DOACOES` | MEDIA | 10 | 6 | Alto volume de doações eleitorais |
| `SITUACAO_IRREGULAR` | ALTA | 25 | 1 | CNPJ com situação cadastral irregular |
| `EMPRESA_RECENTE` | MEDIA | 10 | 1 | Empresa aberta há < 1 ano |
| `MUITAS_EMPRESAS` | MEDIA | 10 | 0 | Sócio em 5+ empresas ativas |
| `MESMO_ENDERECO_REDE` | MEDIA | 15 | 7 | Empresas da rede no mesmo endereço |
| `CLUSTER_EMPRESARIAL` | MEDIA | 15 | 7 | Grupo interconectado de empresas |
| `POSSIVEL_LARANJA` | ALTA | 20 | 7 | Padrão de pessoa laranja |
| `TRIANGULACAO` | ALTA | 25 | 7 | Ciclo suspeito no grafo |
| `TIMING_SUSPEITO` | MEDIA | 15 | 7 | Alterações societárias coincidentes |

---

## 7. Arquitetura dos Multiagentes

### Interface base

Todo agent implementa:

```python
class BaseAgent(ABC):
    name: str
    description: str
    input_types: list[str]       # ["PF", "PJ"]
    required_fields: list[str]   # Campos mínimos na Entity
    rate_limit: int              # requisições por minuto
    timeout: int                 # segundos por entidade

    @abstractmethod
    def investigate(self, entity: Entity, context: InvestigationContext) -> AgentResult:
        """
        Investiga uma entidade.

        Args:
            entity: entidade a investigar
            context: contexto da investigação (grafo, config, etc.)

        Returns:
            AgentResult com findings, new_leads e edges
        """
        pass

@dataclass
class AgentResult:
    agent_name: str
    entity_id: str
    findings: list[Finding]
    new_leads: list[Entity]
    edges: list[Edge]
    matches: list[IdentityMatch]   # matches com scoring de confiança
    metadata: dict                  # tempo, bases consultadas, etc.
    errors: list[str]              # erros não fatais

@dataclass
class InvestigationContext:
    graph: EntityGraph
    config: InvestigationConfig
    rate_limiters: dict
    cache: dict                    # evita re-consultas
    fornecedor_original: Entity    # para comparações de UF, endereço, etc.
```

---

## 8. Agent 0 — Reverse Lookup de Sócios

**Missão:** Dado o NOME + CPF parcial de um sócio, descobrir TODAS as outras empresas onde ele aparece.

**É o agent mais importante depois do QSA.** Sem ele, o sistema só sabe onde o sócio está (na empresa que você consultou). Com ele, o sistema sabe onde MAIS o sócio atua.

### Fontes (em ordem de preferência)

```
1. Base local SQLite/PostgreSQL (se disponível)
   → Mais rápido, mais completo, sem rate limit
   → Requer setup: baixar ~18GB, processar, indexar

2. Casa dos Dados API (se tiver key)
   → Busca por nome_socio, retorna CNPJs
   → Planos a partir de R$49/mês

3. RedeCNPJ online (fallback gratuito)
   → https://www.redecnpj.com
   → Limitado, mas funcional para consultas pontuais

4. Nada de Fraudes (fallback gratuito)
   → https://www.nadadefraudes.com.br
   → Busca CPF+Nome → empresas vinculadas
```

### Lógica

```python
class ReverseLookupAgent(BaseAgent):
    name = "Reverse Lookup"
    input_types = ["PF"]

    def investigate(self, entity: Entity, context: InvestigationContext) -> AgentResult:
        nome = entity.name
        cpf_parcial = entity.cpf_parcial
        findings = []
        new_leads = []
        edges = []

        # ── Buscar todas as empresas ──────────────────
        empresas = self._buscar_empresas(nome, cpf_parcial)

        # ── Filtrar homônimos ─────────────────────────
        empresas_confirmadas = []
        for emp in empresas:
            cpf_na_empresa = extrair_6_digitos(emp.get("cpf_socio", ""))

            if cpf_na_empresa == cpf_parcial:
                # CPF parcial bate → confirmado
                empresas_confirmadas.append({**emp, "confianca": "ALTA"})
            elif not cpf_na_empresa:
                # Sem CPF → possível (precisa mais evidência)
                # Usar nome exato como filtro mínimo
                if normalizar(emp.get("nome_socio", "")) == normalizar(nome):
                    empresas_confirmadas.append({**emp, "confianca": "MEDIA"})
            else:
                # CPF diverge → homônimo, descarta
                pass

        # ── Gerar leads e findings ────────────────────
        for emp in empresas_confirmadas:
            cnpj = emp.get("cnpj", "")
            razao = emp.get("razao_social", "")

            # Pular a empresa que já estamos investigando
            if cnpj == context.fornecedor_original.cnpj:
                continue

            # Calcular prioridade do lead
            prioridade = self._calcular_prioridade(
                emp, context.fornecedor_original
            )

            new_leads.append(Entity(
                id=cnpj,
                type="PJ",
                name=razao,
                cnpj=cnpj,
                depth=entity.depth + 1,
                source_agent=self.name,
                priority=prioridade,
            ))

            edges.append(Edge(
                source_id=entity.id,
                target_id=cnpj,
                relationship="SOCIO_DE",
                metadata={"razao_social": razao, "confianca": emp["confianca"]},
                source_agent=self.name,
            ))

        # ── Findings estruturais ──────────────────────
        n_empresas = len(empresas_confirmadas)

        if n_empresas >= 5:
            findings.append(Finding(
                type="MUITAS_EMPRESAS",
                severity="MEDIA",
                title=f"Sócio em {n_empresas} empresas",
                description=(
                    f"{nome} aparece como sócio em {n_empresas} empresas. "
                    f"Volume acima do padrão pode indicar uso de pessoa interposta."
                ),
                source_agent=self.name,
                source_base="Receita Federal / Casa dos Dados",
                entity_id=entity.id,
                confidence=0.90,
                confidence_level="CONFIRMADO",
                evidencias=[f"{n_empresas} empresas encontradas"],
                data={"empresas": [e.get("cnpj") for e in empresas_confirmadas]},
                recomendacao="Verificar se há padrão de pessoa interposta (laranja).",
            ))

        # Verificar mesmo endereço
        endereco_fornecedor = normalizar(context.fornecedor_original.endereco)
        for emp in empresas_confirmadas:
            endereco_emp = normalizar(emp.get("endereco", ""))
            if endereco_emp and endereco_fornecedor and endereco_emp == endereco_fornecedor:
                findings.append(Finding(
                    type="MESMO_ENDERECO_REDE",
                    severity="MEDIA",
                    title="Outra empresa do sócio no mesmo endereço",
                    description=(
                        f"A empresa {emp.get('razao_social')} "
                        f"({emp.get('cnpj')}) do sócio {nome} "
                        f"tem o mesmo endereço do fornecedor investigado."
                    ),
                    source_agent=self.name,
                    source_base="Receita Federal",
                    entity_id=entity.id,
                    confidence=0.95,
                    confidence_level="CONFIRMADO",
                    evidencias=[f"Endereço: {endereco_fornecedor}"],
                    data=emp,
                    recomendacao="Investigar se empresas compartilham estrutura ou são de fachada.",
                ))

        return AgentResult(
            agent_name=self.name,
            entity_id=entity.id,
            findings=findings,
            new_leads=new_leads,
            edges=edges,
            matches=[],
            metadata={"empresas_encontradas": n_empresas},
            errors=[],
        )

    def _calcular_prioridade(self, empresa: dict, fornecedor: Entity) -> float:
        """Calcula prioridade de um lead descoberto."""
        score = 0.5

        # Mesmo endereço → alta prioridade
        if normalizar(empresa.get("endereco", "")) == normalizar(fornecedor.endereco):
            score += 0.30

        # Mesmo CNAE → prioridade
        if empresa.get("cnae") == fornecedor.cnae:
            score += 0.20

        # Empresa recente
        data_abertura = empresa.get("data_abertura", "")
        if data_abertura:
            try:
                from datetime import datetime, date
                dt = datetime.strptime(str(data_abertura)[:10], "%Y-%m-%d").date()
                if (date.today() - dt).days < 365:
                    score += 0.15
            except (ValueError, TypeError):
                pass

        # Empresa inativa → baixa prioridade
        situacao = str(empresa.get("situacao", "")).upper()
        if "BAIXA" in situacao:
            score -= 0.30

        return max(0.1, min(score, 1.0))
```

---

## 9–14. Agents 1–6

### Agent 1 — QSA Deep Explorer

**Input:** CNPJ
**Output:** Lista de sócios com `SocioIdentity`, dados da empresa
**Busca por:** CNPJ (direto)
**Desambiguação:** Não aplicável (dados vêm direto da fonte)

Extrai QSA do OpenCNPJ ou base local. Para cada sócio PF, constrói um `SocioIdentity` com nome, CPF parcial e raridade calculada. Gera leads para o Agent 0 (reverse lookup) e para os agents de verificação.

### Agent 2 — Sanctions Scanner

**Input:** PF (nome + CPF parcial) ou PJ (CNPJ)
**Output:** Matches contra CEIS, CNEP, CEPIM, CEAF, Trabalho Escravo, TCU
**Busca por:** CNPJ direto (para PJ) ou nomeSancionado (para PF)
**Desambiguação:** Aplica motor completo para buscas por nome

```python
# Para PJ: busca direta por CNPJ (sem ambiguidade)
resp = requests.get(CEIS_ENDPOINT, params={"cnpjSancionado": cnpj})

# Para PF: busca por nome + validação com CPF parcial
resp = requests.get(CEIS_ENDPOINT, params={"nomeSancionado": nome})
for resultado in resp.json():
    match = IdentityMatch(socio=socio, nome_encontrado=..., cpf_encontrado=...)
    match = calcular_confianca(socio, match)
    if match.nivel != "DESCARTADO":
        findings.append(...)
```

### Agent 3 — PEP & Conflict Analyzer

**Input:** PF (nome + CPF parcial)
**Output:** Matches em servidores federais, TSE (candidaturas, filiações)
**Busca por:** Nome
**Desambiguação:** Aplica motor completo. Cruzamento PEP + Agent 4 (contratos) gera flags de conflito de interesse.

### Agent 4 — Contratos & Licitações

**Input:** PJ (CNPJ)
**Output:** Contratos federais, licitações, dispensas
**Busca por:** CNPJ direto (sem ambiguidade)
**Desambiguação:** Não aplicável

Cruzamento com Agent 3: se sócio é servidor do órgão contratante → flag CRITICO `SERVIDOR_ORGAO_CONTRATANTE`.

### Agent 5 — Judicial & Dívidas

**Input:** PF (nome) ou PJ (CNPJ)
**Output:** Processos judiciais, dívida ativa, protestos
**Busca por:** Nome (DataJud) ou CNPJ (PGFN)
**Desambiguação:** Aplica motor completo para buscas por nome no DataJud. Processos por CNPJ são sem ambiguidade.

### Agent 6 — Doações Eleitorais

**Input:** PF (nome + CPF parcial) ou PJ (CNPJ)
**Output:** Doações para campanhas eleitorais
**Busca por:** Nome ou CNPJ nos CSVs do TSE
**Desambiguação:** TSE retorna CPF completo do doador nos dados de prestação de contas → desambiguação forte (os 6 dígitos do meio vão bater ou não).

---

## 15. Agent 7 — Network Analyzer (Meta-Agent)

Não consulta bases externas. Analisa o grafo construído pelos outros agents.

### Análises

```python
class NetworkAnalyzer(BaseAgent):
    """
    Analisa o grafo completo e identifica padrões estruturais
    que nenhum agent individual consegue ver.
    """

    def analyze(self, graph: EntityGraph) -> list[Finding]:
        findings = []

        findings += self._detectar_clusters(graph)
        findings += self._detectar_laranjas(graph)
        findings += self._detectar_triangulacao(graph)
        findings += self._detectar_timing_suspeito(graph)
        findings += self._calcular_centralidade(graph)

        return findings

    def _detectar_laranjas(self, graph: EntityGraph) -> list[Finding]:
        """
        Padrão: PF com participação em muitas empresas do mesmo ramo,
        todas com capital social mínimo, no mesmo endereço ou UF.
        """
        for pf in graph.get_entities(type="PF"):
            empresas = graph.get_connected(pf.id, relationship="SOCIO_DE")
            if len(empresas) < 5:
                continue

            # Verificar padrão
            cnaes = [e.cnae for e in empresas if e.cnae]
            enderecos = [normalizar(e.endereco) for e in empresas if e.endereco]
            capitais = [e.capital_social for e in empresas]

            # Muitas empresas no mesmo CNAE?
            from collections import Counter
            cnae_counter = Counter(cnaes)
            cnae_mais_comum, qtd = cnae_counter.most_common(1)[0] if cnaes else ("", 0)

            # Muitas empresas no mesmo endereço?
            endereco_counter = Counter(enderecos)
            end_mais_comum, qtd_end = endereco_counter.most_common(1)[0] if enderecos else ("", 0)

            # Capital social baixo em todas?
            capital_baixo = all(c < 10000 for c in capitais if c > 0)

            if (qtd >= 3 or qtd_end >= 2) and capital_baixo:
                # Padrão forte de laranja
                yield Finding(
                    type="POSSIVEL_LARANJA",
                    severity="ALTA",
                    title=f"Possível pessoa interposta: {pf.name}",
                    description=(
                        f"{pf.name} é sócio de {len(empresas)} empresas. "
                        f"{qtd} no mesmo CNAE ({cnae_mais_comum}), "
                        f"{qtd_end} no mesmo endereço. "
                        f"Capital social baixo em todas. "
                        f"Padrão compatível com uso de pessoa interposta."
                    ),
                    confidence=0.75,
                    confidence_level="PROVAVEL",
                    recomendacao=(
                        "Investigação aprofundada recomendada. "
                        "Verificar se há vínculo empregatício ou familiar "
                        "com o beneficiário real."
                    ),
                    # ...
                )

    def _detectar_triangulacao(self, graph: EntityGraph) -> list[Finding]:
        """
        Detecta ciclos no grafo: A → B → C → A
        Onde A, B, C são empresas e os sócios se cruzam.
        """
        # Usar NetworkX para detecção de ciclos
        import networkx as nx
        G = graph.to_networkx()
        cycles = list(nx.simple_cycles(G))
        # Filtrar ciclos relevantes (envolvendo ao menos 1 PJ)
        # ...
```

---

## 16. Orquestrador (Investigation Loop)

```python
class Orchestrator:

    def __init__(self, config: InvestigationConfig):
        self.agents = {
            "reverse_lookup": ReverseLookupAgent(),
            "qsa_explorer": QSADeepExplorer(),
            "sanctions": SanctionsScanner(),
            "pep": PEPAnalyzer(),
            "contratos": ContratosAgent(),
            "judicial": JudicialAgent(),
            "doacoes": DoacoesAgent(),
        }
        self.network_analyzer = NetworkAnalyzer()
        self.graph = EntityGraph()
        self.queue = PriorityQueue()
        self.visited = set()
        self.config = config
        self.start_time = None

    def investigate(self, cnpj: str) -> InvestigationResult:

        self.start_time = time.time()

        # ── 1. Seed ───────────────────────────────────
        seed = Entity(id=cnpj, type="PJ", cnpj=cnpj, depth=0, priority=1.0)
        self.queue.push(seed)

        # ── 2. Investigation Loop ─────────────────────
        while not self.queue.empty():

            # Checagens de segurança
            if len(self.visited) >= self.config.MAX_ENTITIES:
                break
            if self._elapsed() >= self.config.MAX_TIME:
                break

            entity = self.queue.pop()

            if entity.id in self.visited:
                continue
            if entity.depth > self.config.MAX_DEPTH:
                continue
            if entity.priority < self.config.RELEVANCE_THRESHOLD:
                continue

            self.visited.add(entity.id)

            # Emitir progresso (WebSocket para frontend)
            self._emit_progress(entity)

            # ── 3. Executar agents relevantes ─────────

            if entity.type == "PJ":
                # Para empresas: QSA + Sanctions + Contratos
                self._run_agent("qsa_explorer", entity)
                self._run_agents_parallel(
                    ["sanctions", "contratos"],
                    entity
                )

            elif entity.type == "PF":
                # Para pessoas: Reverse Lookup PRIMEIRO,
                # depois os demais em paralelo
                self._run_agent("reverse_lookup", entity)
                self._run_agents_parallel(
                    ["sanctions", "pep", "judicial", "doacoes"],
                    entity
                )

        # ── 4. Convergência cross-agent ───────────────
        # Para cada sócio PF, aplicar bonus de convergência
        for entity in self.graph.get_entities(type="PF"):
            matches = entity.matches
            if matches:
                aplicar_convergencia(entity, matches)

        # ── 5. Network Analyzer ───────────────────────
        network_findings = self.network_analyzer.analyze(self.graph)
        for f in network_findings:
            self.graph.add_finding(f)

        # ── 6. Risk Score ─────────────────────────────
        risk = GraphAwareRiskScorer(self.graph, self.config).calculate()

        # ── 7. Relatório ──────────────────────────────
        return InvestigationResult(
            graph=self.graph,
            risk=risk,
            stats=self._stats(),
        )

    def _run_agents_parallel(self, agent_names: list, entity: Entity):
        """Roda múltiplos agents em paralelo para uma entidade."""
        import asyncio
        # Implementar com asyncio ou ThreadPoolExecutor
        # Cada agent respeita seu próprio rate limiter
        for name in agent_names:
            self._run_agent(name, entity)

    def _run_agent(self, agent_name: str, entity: Entity):
        """Roda um agent e processa seus resultados."""
        agent = self.agents[agent_name]
        context = InvestigationContext(
            graph=self.graph,
            config=self.config,
            fornecedor_original=self.graph.get_root(),
        )

        try:
            result = agent.investigate(entity, context)

            # Adicionar findings ao grafo
            for f in result.findings:
                self.graph.add_finding(f)

            # Adicionar edges
            for e in result.edges:
                self.graph.add_edge(e)

            # Adicionar matches (para convergência posterior)
            entity.matches.extend(result.matches)

            # Novos leads → fila
            for lead in result.new_leads:
                lead.depth = entity.depth + 1
                if lead.id not in self.visited:
                    self.queue.push(lead)

        except Exception as e:
            # Log error, não para a investigação
            self.graph.add_error(agent_name, entity.id, str(e))
```

---

## 17. Risk Scorer (Graph-Aware)

O scorer v2 leva em conta não só os flags individuais, mas a posição da entidade no grafo.

```python
class GraphAwareRiskScorer:

    def calculate(self) -> RiskResult:
        score = 0
        all_findings = self.graph.get_all_findings()

        for finding in all_findings:
            # Peso base do flag
            peso = FLAG_WEIGHTS.get(finding.type, 0)

            # Ajuste pela confiança do match
            if finding.confidence_level == "CONFIRMADO":
                peso_ajustado = peso * 1.0
            elif finding.confidence_level == "PROVAVEL":
                peso_ajustado = peso * 0.7
            elif finding.confidence_level == "POSSIVEL":
                peso_ajustado = peso * 0.3
            else:
                peso_ajustado = 0  # DESCARTADO não conta

            # Ajuste pela profundidade (flags mais distantes pesam menos)
            entity = self.graph.get_entity(finding.entity_id)
            depth_factor = 1.0 / (1 + entity.depth * 0.3)
            # depth 0: 1.0, depth 1: 0.77, depth 2: 0.63, depth 3: 0.53

            score += peso_ajustado * depth_factor

        score = min(int(score), 100)

        # Determinar nível
        if score >= 70:   nivel = "CRITICO"
        elif score >= 45: nivel = "ALTO"
        elif score >= 20: nivel = "MEDIO"
        else:             nivel = "BAIXO"

        return RiskResult(score=score, nivel=nivel, ...)
```

---

## 18. Geração de Relatório

### Regras de exibição por nível de confiança

```
CONFIRMADO (>= 0.85):
  → Exibir como flag firme
  → Cor sólida do nível de severidade
  → Texto assertivo: "Sócio XXXX consta no CEIS"
  → Ícone: ⛔ 🔴 🟡 conforme severidade

PROVAVEL (0.60 — 0.84):
  → Exibir como flag com borda tracejada
  → Cor com 70% opacidade
  → Texto com ressalva: "Sócio XXXX possivelmente consta no CEIS
    (Mesmo nome + mesma UF. Verificação recomendada)"
  → Botão: "Ver evidências"

POSSIVEL (0.40 — 0.59):
  → Exibir em seção separada "Pontos de Atenção"
  → Cor neutra (cinza/azul)
  → Texto cauteloso: "Homônimo de XXXX encontrado no CEIS.
    Dados insuficientes para confirmar identidade."
  → Botão: "Verificar manualmente"
  → Painel expandível com dados lado a lado:
    [O que temos do sócio] vs [O que a base retornou]

DESCARTADO / HOMONIMO_CERTO:
  → NÃO aparece no relatório
  → Registrado apenas no log de auditoria
```

### Painel "Verificar manualmente"

Quando o advogado clica em "Verificar manualmente" num match POSSIVEL:

```
┌─────────────────────────────────────────────────────────────┐
│  VERIFICAÇÃO MANUAL                                          │
│                                                              │
│  ┌──────────────────┐    ┌──────────────────┐               │
│  │ SÓCIO NO QSA     │    │ MATCH NO CEIS    │               │
│  ├──────────────────┤    ├──────────────────┤               │
│  │ Nome:            │    │ Nome:            │               │
│  │ JOAO CARLOS DA   │    │ JOAO CARLOS DA   │  ← iguais    │
│  │ SILVA            │    │ SILVA            │               │
│  │                  │    │                  │               │
│  │ CPF: ***718468** │    │ CPF: não inform. │  ← sem CPF    │
│  │                  │    │                  │               │
│  │ UF: SP           │    │ UF: RJ           │  ← diferente │
│  │ Município:       │    │ Órgão:           │               │
│  │ São Paulo        │    │ Pref. de Niterói │               │
│  │                  │    │                  │               │
│  │ Empresa:         │    │ Sanção:          │               │
│  │ FORNECEDOR LTDA  │    │ Impedimento      │               │
│  │ CNPJ: 12.345...  │    │ 2023-2025        │               │
│  └──────────────────┘    └──────────────────┘               │
│                                                              │
│  Confiança calculada: 42% (POSSÍVEL)                        │
│  Evidências:                                                 │
│  ✓ Nome completo exato (+0.40)                              │
│  ✗ CPF não disponível na base                               │
│  ✗ UF diferente (SP vs RJ) (-0.03)                          │
│  → Nome muito comum: MEDIO (x1.0)                           │
│                                                              │
│  [ É a mesma pessoa ]  [ Não é a mesma pessoa ]  [ Pular ] │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 19. UX: Níveis de Confiança no Frontend

O designer deve criar 3 estados visuais distintos para findings:

### Estado CONFIRMADO
- Background: cor do nível de severidade com 15% opacidade
- Borda esquerda: cor sólida, 3px
- Ícone: preenchido, sem indicador de dúvida
- Badge: "Confirmado" em verde

### Estado PROVÁVEL
- Background: cor do nível de severidade com 8% opacidade
- Borda esquerda: cor com 70% opacidade, 3px, **tracejada**
- Ícone: com "?" sobreposto
- Badge: "Provável — Verificar" em amarelo

### Estado POSSÍVEL
- Background: cinza neutro com 5% opacidade
- Borda esquerda: cinza, 2px
- Ícone: outline only
- Badge: "Atenção — Verificação necessária" em azul
- Botão expandir: mostra painel de verificação manual

---

## 20. Fontes de Dados

### APIs com acesso direto

| Base | URL | Auth | Rate Limit | Busca por nome? |
|------|-----|------|-----------|----------------|
| OpenCNPJ | `api.opencnpj.org/{cnpj}` | Nenhuma | 50/s | Não (só CNPJ) |
| Portal Transparência | `portaldatransparencia.gov.br/api-de-dados` | Chave gratuita | 90/min | Sim |
| Casa dos Dados | `api.casadosdados.com.br/v5` | API key (pago) | Variável | Sim (nome_socio) |
| BrasilAPI | `brasilapi.com.br/api/cnpj/v1/{cnpj}` | Nenhuma | Variável | Não |
| DataJud (CNJ) | `datajud-wiki.cnj.jus.br` | Cadastro | 20/min | Sim |
| Querido Diário | `queridodiario.ok.org.br/api` | Nenhuma | — | Sim |
| Nada de Fraudes | `nadadefraudes.com.br` | Nenhuma | Web | Sim (CPF+Nome) |

### Downloads em massa

| Base | URL | Frequência | Tamanho |
|------|-----|-----------|---------|
| CNPJ completo (RF) | `dados.gov.br/dados/conjuntos-dados/cadastro-nacional-da-pessoa-juridica---cnpj` | Mensal | ~18GB zip |
| TSE (tudo) | `dadosabertos.tse.jus.br` | Por eleição | Variável |
| CEIS/CNEP/CEPIM | `portaldatransparencia.gov.br/download-de-dados` | Mensal | Pequeno |
| Trabalho Escravo | `portaldatransparencia.gov.br/download-de-dados` | Semestral | Pequeno |
| IBAMA | `dadosabertos.ibama.gov.br` | Mensal | Médio |
| Servidores | `portaldatransparencia.gov.br/download-de-dados` | Mensal | Grande |

### Base local recomendada

Para produção, montar base local SQLite/PostgreSQL com:

```
1. github.com/rictom/cnpj-sqlite → gera cnpj.db (~50GB SQLite)
2. Criar índices:
   - socios(nome_socio)
   - socios(cnpj_cpf_socio)
   - socios(nome_socio, cnpj_cpf_socio)
   - empresas(cnpj_basico)
3. Atualizar mensalmente com novos dumps da RF
```

---

## 21. Infraestrutura e Deploy

### MVP (semana 1-2)
- Python 3.11+
- SQLite para cache de resultados
- Execução local via CLI
- Relatórios HTML estáticos

### Produção (mês 1-2)
- FastAPI para API REST
- WebSocket para progresso em tempo real
- PostgreSQL para base de CNPJs + resultados
- Redis para cache de consultas a APIs
- Celery para fila de jobs (análises longas)
- Docker para deploy

### Escalado (mês 3+)
- Frontend React com grafo interativo (D3.js ou Sigma.js)
- Dashboard de monitoramento contínuo
- Alertas por email/Slack quando score muda
- Integração com sistema de compliance FIUS

---

## 22. Base Legal e LGPD

### Dados utilizados: todos públicos e abertos

- Lei de Acesso à Informação (Lei 12.527/2011)
- Política de Dados Abertos (Decreto 8.777/2016)
- Marco Civil da Internet (Lei 12.965/2014)

### Cuidados LGPD (Lei 13.709/2018)

- Base legal: legítimo interesse (art. 10) para due diligence e compliance
- CPFs mascarados no output (***456.789-**)
- Registro de finalidade em todo relatório
- Log de auditoria: quem consultou, quando, para que finalidade
- Direito de oposição: rotina de exclusão mediante solicitação
- Relatórios não redistribuíveis sem controle
- Disclaimer obrigatório em todo relatório gerado

---

## 23. Roadmap de Implementação

### Fase 1 — Fundação (Semana 1-2)
- [ ] Dataclasses: `SocioIdentity`, `Entity`, `Finding`, `Edge`, `IdentityMatch`
- [ ] Motor de desambiguação: `calcular_confianca()`
- [ ] Funções auxiliares: `normalizar()`, `extrair_6_digitos()`, `calcular_raridade()`
- [ ] `PriorityQueue` com deduplicação
- [ ] `EntityGraph` (NetworkX ou dict)
- [ ] `Orchestrator` com investigation loop
- [ ] Refatorar Agent 1 (QSA) para saída com `SocioIdentity`
- [ ] Refatorar Agent 2 (Listas) para busca por NOME + desambiguação

### Fase 2 — Agents Essenciais (Semana 2-3)
- [ ] Agent 0: Reverse Lookup (Casa dos Dados API ou base local)
- [ ] Agent 2 expandido: CEIS + CNEP + CEPIM + CEAF + Trabalho Escravo
- [ ] Agent 3 expandido: Servidores + TSE candidaturas
- [ ] Agent 4: Contratos & Licitações
- [ ] Convergência cross-agent
- [ ] Relatório HTML com níveis de confiança

### Fase 3 — Inteligência (Semana 3-4)
- [ ] Agent 5: Judicial (DataJud)
- [ ] Agent 6: Doações eleitorais (TSE)
- [ ] Agent 7: Network Analyzer
- [ ] Risk Scorer graph-aware
- [ ] Base local SQLite da Receita Federal
- [ ] Paralelismo com asyncio

### Fase 4 — Produção (Semana 4-6)
- [ ] API FastAPI
- [ ] WebSocket para progresso real-time
- [ ] Frontend com grafo interativo
- [ ] Modo batch + CSV consolidado
- [ ] Cache Redis
- [ ] Docker + deploy
- [ ] Integração com sistema de compliance FIUS

---

*Supply Risk Mapping — FIUS Innovation Hub*
*Especificação Técnica v2.0*
*Fevereiro 2026*
