# Supply Risk Mapping — Blueprint dos Multiagentes

## FIUS Innovation Hub | Documento Técnico para Desenvolvimento

---

## 1. O problema do sistema atual

O sistema v1 faz isso:

```
CNPJ → puxa QSA → checa 3 listas → score → fim
```

O problema: ele **encontra os sócios mas não investiga os sócios**. Ele olha para o CPF e pergunta "está numa lista?". Mas não pergunta "esse CPF é sócio de mais 12 empresas, uma delas fornece para o mesmo órgão, outra foi aberta há 3 meses, e o endereço é o mesmo de uma empresa que já foi punida no CEIS?".

O que precisamos:

```
CNPJ → puxa QSA → para CADA CPF/CNPJ encontrado:
  → descobre TODAS as empresas vinculadas
  → descobre familiares (quando declarados)
  → checa TODAS as listas restritivas
  → checa processos judiciais
  → checa doações eleitorais
  → checa se é servidor público
  → checa contratos públicos
  → checa dívida ativa
  → cada descoberta gera NOVOS leads
  → novos leads alimentam os mesmos agents
  → só para quando não há mais leads inéditos
```

---

## 2. Filosofia: "Scrape until dry"

O princípio central é o **grafo expansível com fila de investigação**.

### Conceito

O sistema mantém duas estruturas:

**Fila de Investigação** (`investigation_queue`): CPFs e CNPJs descobertos que ainda não foram processados.

**Grafo de Entidades** (`entity_graph`): Todas as entidades já investigadas e suas conexões.

```
┌─────────────────────────────────────────────────────┐
│                INVESTIGATION LOOP                    │
│                                                      │
│   queue.push(CNPJ_inicial)                          │
│                                                      │
│   while queue is not empty:                          │
│     entity = queue.pop()                             │
│     if entity in visited: skip                       │
│     visited.add(entity)                              │
│                                                      │
│     results = run_all_agents(entity)                 │
│     graph.add(entity, results)                       │
│                                                      │
│     new_leads = extract_leads(results)               │
│     for lead in new_leads:                           │
│       if lead not in visited:                        │
│         if depth(lead) <= MAX_DEPTH:                 │
│           queue.push(lead)                           │
│                                                      │
│   return graph                                       │
└─────────────────────────────────────────────────────┘
```

### Controles de segurança

Sem controles, o sistema pode explodir exponencialmente. Cada sócio pode ter 5 empresas, cada empresa 4 sócios, e assim por diante.

**Parâmetros de contenção:**

| Parâmetro | Valor Padrão | Descrição |
|-----------|-------------|-----------|
| `MAX_DEPTH` | 3 | Profundidade máxima de recursão a partir do CNPJ original |
| `MAX_ENTITIES` | 100 | Número máximo de entidades (CPFs + CNPJs) a investigar |
| `MAX_TIME` | 300s | Timeout total da investigação |
| `RELEVANCE_THRESHOLD` | 0.3 | Score mínimo de relevância para seguir um lead |
| `SKIP_INACTIVE_COMPANIES` | true | Ignorar empresas com situação "Baixada" há mais de 5 anos |

### Relevância de leads

Nem todo lead descoberto merece investigação. O sistema deve priorizar:

**Leads de alta prioridade (investigar sempre):**
- Sócio PF que aparece em mais de 3 empresas
- Empresa com mesmo endereço do fornecedor original
- Sócio que também é servidor público
- Empresa aberta nos últimos 12 meses
- Qualquer match em lista restritiva

**Leads de média prioridade (investigar se dentro do budget):**
- Sócio PJ (empresa holding)
- Empresas do mesmo CNAE do fornecedor
- Sócios com entrada recente na sociedade (< 6 meses)

**Leads de baixa prioridade (ignorar por padrão):**
- Empresas baixadas há mais de 5 anos
- Sócios que saíram da sociedade há mais de 5 anos
- Empresas em UFs diferentes sem conexão aparente

---

## 3. Arquitetura dos Agents

### Visão geral do pipeline

```
                    ┌─────────────────────┐
                    │    ORCHESTRATOR     │
                    │  (Investigation     │
                    │   Loop Controller)  │
                    └────────┬────────────┘
                             │
              ┌──────────────┼──────────────────┐
              │              │                   │
              ▼              ▼                   ▼
         ┌─────────┐   ┌─────────┐        ┌─────────┐
         │ AGENT 1 │   │ AGENT 2 │  ...   │ AGENT N │
         │ QSA Deep│   │ Listas  │        │ Judicl  │
         └────┬────┘   └────┬────┘        └────┬────┘
              │              │                   │
              ▼              ▼                   ▼
         ┌──────────────────────────────────────────┐
         │            ENTITY GRAPH                   │
         │  (Neo4j / NetworkX / Dict in memory)      │
         └──────────────────────┬───────────────────┘
                                │
                                ▼
                    ┌─────────────────────┐
                    │    RISK SCORER      │
                    │  (Graph-aware)      │
                    └────────┬────────────┘
                             │
                             ▼
                    ┌─────────────────────┐
                    │  REPORT GENERATOR   │
                    └─────────────────────┘
```

### Interface padrão de cada Agent

Todo agent deve implementar esta interface:

```python
class BaseAgent:
    """Interface base para todos os agents."""

    name: str               # Ex: "QSA Deep Explorer"
    description: str        # O que este agent faz
    input_types: list[str]  # ["CPF", "CNPJ", "NOME"]
    rate_limit: int         # requisições por minuto

    def investigate(self, entity: Entity) -> AgentResult:
        """
        Investiga uma entidade e retorna resultados + novos leads.

        Args:
            entity: CPF, CNPJ ou Nome a investigar

        Returns:
            AgentResult com:
              - findings: lista de achados (flags, dados, conexões)
              - new_leads: lista de novas entidades descobertas
              - edges: conexões entre entidades (para o grafo)
              - metadata: tempo de execução, bases consultadas, etc.
        """
        pass
```

```python
@dataclass
class Entity:
    id: str              # CPF ou CNPJ (só dígitos)
    type: str            # "CPF" | "CNPJ"
    name: str            # Nome da pessoa ou razão social
    depth: int           # Distância do CNPJ original
    source: str          # Qual agent descobriu esta entidade
    priority: float      # 0.0 a 1.0 — quão urgente investigar

@dataclass
class AgentResult:
    agent_name: str
    entity_id: str
    findings: list[Finding]
    new_leads: list[Entity]
    edges: list[Edge]          # Conexões para o grafo
    metadata: dict

@dataclass
class Finding:
    type: str            # "SANCAO", "PEP", "PROCESSO", etc.
    severity: str        # "CRITICA", "ALTA", "MEDIA", "BAIXA", "INFO"
    title: str           # Resumo curto
    description: str     # Detalhamento
    source: str          # Base de dados de origem
    data: dict           # Dados brutos

@dataclass
class Edge:
    source_id: str       # CPF ou CNPJ de origem
    target_id: str       # CPF ou CNPJ de destino
    relationship: str    # "SOCIO_DE", "DOOU_PARA", "CONTRATADO_POR", etc.
    metadata: dict       # Dados adicionais (valor, data, etc.)
```

---

### Agent 1 — QSA Deep Explorer

**Missão:** Dado um CPF, descobrir TODAS as empresas onde essa pessoa é ou foi sócia. Dado um CNPJ, extrair TODOS os sócios.

**Fonte:** Receita Federal (via OpenCNPJ ou base local)

**A sacada:** A API OpenCNPJ permite consultar por CNPJ, mas não por CPF. Para o "reverse lookup" (CPF → empresas), existem duas abordagens:

1. **Base local da Receita Federal:** Baixar a base completa (~550GB), importar para PostgreSQL/BigQuery, e fazer queries diretas por CPF nos campos de sócio. Essa é a abordagem do Bruno César.

2. **APIs alternativas:** Serviços como BrasilAPI, Casa dos Dados, CNPJs.rocks oferecem busca reversa (CPF → empresas). Algumas são gratuitas com limites.

3. **Base dos Dados (basedosdados.org):** Tem a base de empresas e sócios da Receita Federal no BigQuery. Permite queries SQL diretas.

**Lógica do agent:**

```
INPUT: Entity (CPF ou CNPJ)

SE tipo == CNPJ:
  1. Consultar OpenCNPJ → extrair QSA
  2. Para cada sócio PF: criar lead (CPF, prioridade ALTA)
  3. Para cada sócio PJ: criar lead (CNPJ, prioridade MEDIA)
  4. Registrar edges: SOCIO_DE, ADMINISTRADOR_DE

SE tipo == CPF:
  1. Buscar TODAS as empresas onde CPF é sócio (base local ou API reversa)
  2. Para cada empresa encontrada:
     a. Se empresa não está no grafo → criar lead (CNPJ, prioridade calculada)
     b. Registrar edge: SOCIO_DE
  3. Calcular métricas:
     - Quantas empresas ativas?
     - Alguma empresa no mesmo CNAE do fornecedor original?
     - Alguma empresa com mesmo endereço?
     - Alguma empresa aberta recentemente?

FINDINGS gerados:
  - MUITAS_EMPRESAS: CPF é sócio de 5+ empresas ativas
  - MESMO_ENDERECO: Empresa do sócio no mesmo endereço do fornecedor
  - MESMO_CNAE: Empresa do sócio no mesmo ramo do fornecedor
  - EMPRESA_RECENTE: Sócio abriu empresa nos últimos 12 meses
  - SOCIO_OCULTO: Sócio PJ que é holding de outro sócio PF (indireção)
```

**Prioridade de leads gerados:**

```python
def calcular_prioridade(empresa_descoberta, fornecedor_original):
    score = 0.5  # base

    if mesmo_endereco(empresa_descoberta, fornecedor_original):
        score += 0.3
    if mesmo_cnae(empresa_descoberta, fornecedor_original):
        score += 0.2
    if empresa_descoberta.data_abertura > (hoje - 365 dias):
        score += 0.2
    if empresa_descoberta.situacao != "ATIVA":
        score -= 0.2
    if empresa_descoberta.situacao == "BAIXADA" and anos_baixada > 5:
        score -= 0.4

    return min(max(score, 0.0), 1.0)
```

---

### Agent 2 — Sanctions Scanner (expandido)

**Missão:** Verificar CPF/CNPJ contra TODAS as listas restritivas disponíveis.

**Fontes:**

| Lista | API/Download | Entidade | O que significa |
|-------|-------------|----------|-----------------|
| CEIS | API Portal Transparência | CNPJ + CPF | Inidôneo/Suspenso |
| CNEP | API Portal Transparência | CNPJ | Punido Lei Anticorrupção |
| CEPIM | API Portal Transparência | CNPJ | Entidade impedida |
| CEAF | API Portal Transparência | CPF | Expulsos da adm. federal |
| Lista Trabalho Escravo | Download CSV (MTE) | CNPJ + CPF | Trabalho análogo à escravidão |
| TCU Inidôneos | Download (TCU) | CNPJ + CPF | Contas julgadas irregulares |
| TCU Inabilitados | Download (TCU) | CPF | Inabilitados para cargo |
| Sanções internacionais | OFAC (EUA), EU Sanctions | Nome + Doc | Sanções internacionais |
| IBAMA Autos | Download (IBAMA) | CNPJ + CPF | Multas ambientais |
| Acordos de Leniência | API Portal Transparência | CNPJ | Empresa em acordo de leniência |

**Lógica expandida:**

```
INPUT: Entity (CPF ou CNPJ)

1. Consultar TODAS as listas em paralelo (async)
2. Para cada match:
   a. Classificar severidade (CRITICA, ALTA, MEDIA)
   b. Extrair detalhes (órgão sancionador, período, motivo)
   c. Se match em CEIS/CNEP → elevar prioridade de TODOS os
      sócios dessa empresa na fila
3. Cruzamento inteligente:
   - Se CPF do sócio aparece no CEAF (expulso da adm. federal)
     E esse sócio é de empresa que contrata com o governo → CRÍTICO
   - Se empresa está em Acordo de Leniência → informativo, mas
     pode indicar histórico de problemas
```

---

### Agent 3 — PEP & Conflict Analyzer (expandido)

**Missão:** Identificar Pessoas Expostas Politicamente e conflitos de interesse.

**Fontes:**

| Base | Conteúdo | Acesso |
|------|----------|--------|
| Servidores Federais | Cargo, órgão, remuneração | API Portal Transparência |
| Portais Estaduais | Servidores estaduais | Scraping / APIs variadas |
| TSE Candidaturas | Candidatos e ex-candidatos | Download CSV |
| TSE Filiações | Filiados a partidos | Download CSV |
| TSE Bens | Bens declarados por candidatos | Download CSV |
| Diários Oficiais (DOU) | Nomeações, exonerações | Querido Diário API / IMPRENSA NACIONAL |

**Lógica expandida:**

```
INPUT: Entity (CPF, com nome)

1. Verificar servidor federal (API Portal Transparência)
2. Verificar servidor estadual (portais por UF — quando disponível)
3. Buscar no TSE:
   a. Foi candidato? Quando? Para qual cargo?
   b. Está filiado a partido? Qual?
   c. Bens declarados vs. capital social das empresas
4. Buscar no DOU/Diários:
   a. Foi nomeado para cargo comissionado?
   b. Exonerações recentes?
5. Cruzamento inteligente:
   - Sócio é servidor no órgão que contrata o fornecedor → CRÍTICO
   - Sócio é ex-candidato que recebeu doação de empresa
     do mesmo grupo do fornecedor → ALTO
   - Sócio filiado ao mesmo partido do prefeito/governador
     que contratou o fornecedor → MÉDIO (correlação, não causalidade)

FINDINGS:
  - SERVIDOR_ORGAO_CONTRATANTE: Conflito de interesse direto
  - EX_CANDIDATO: Exposição política
  - FILIADO_PARTIDO: Exposição política leve
  - NOMEACAO_RECENTE: Possível relação com poder
  - PATRIMONIO_INCOMPATIVEL: Bens declarados vs. participações societárias
```

---

### Agent 4 — Contratos & Licitações (NOVO)

**Missão:** Verificar se o fornecedor ou empresas dos sócios têm contratos com o governo, e se há padrões suspeitos.

**Fontes:**
- API Portal da Transparência (contratos e licitações federais)
- ComprasNet / PNCP (Portal Nacional de Contratações Públicas)
- Portais municipais de transparência

**Lógica:**

```
INPUT: Entity (CNPJ)

1. Buscar contratos federais do CNPJ (API Portal Transparência)
2. Buscar licitações que o CNPJ participou
3. Para cada contrato encontrado:
   a. Valor do contrato
   b. Órgão contratante
   c. Modalidade de licitação (dispensa? inexigibilidade?)
   d. Vigência
4. Cruzamento com outros agents:
   - O sócio da empresa é servidor do órgão contratante?
     (Agent 3 já sabe isso)
   - Outra empresa do mesmo sócio também contrata com
     o mesmo órgão? (Agent 1 já mapeou as empresas)
   - Valor dos contratos vs. porte/capital social da empresa
     → desproporcional?

FINDINGS:
  - CONTRATO_GOVERNO: Informativo — tem contratos públicos
  - DISPENSA_LICITACAO: Contratado por dispensa (> R$ 50k)
  - CONCENTRACAO_ORGAO: Múltiplos contratos com mesmo órgão
  - VALOR_DESPROPORCIONAL: Contrato > 10x capital social
  - SOCIO_NO_ORGAO: Sócio é servidor do órgão contratante
```

---

### Agent 5 — Judicial & Dívidas (NOVO)

**Missão:** Verificar processos judiciais e dívidas que indiquem risco financeiro ou legal.

**Fontes:**

| Base | Conteúdo | Acesso |
|------|----------|--------|
| DataJud / CNJ | Processos de todas as esferas | API CNJ |
| TST / TRTs | Processos trabalhistas | APIs dos tribunais |
| PGFN | Dívida Ativa da União | Consulta online / API |
| Protestos | Títulos protestados | Centrais estaduais |
| CND Federal | Certidão de débitos federais | Consulta online |
| CND Trabalhista | Certidão trabalhista | TST |
| CND FGTS | Regularidade FGTS | Caixa |

**Lógica:**

```
INPUT: Entity (CPF ou CNPJ)

1. DataJud: buscar processos
   a. Quantos processos ativos?
   b. Como autor ou réu?
   c. Assuntos (trabalhista, cível, criminal, tributário)
   d. Valores envolvidos
2. PGFN: verificar dívida ativa
3. Protestos: verificar títulos protestados (quando disponível)
4. CNDs: verificar regularidade

FINDINGS:
  - PROCESSOS_CRIMINAIS: Processos criminais ativos
  - VOLUME_TRABALHISTAS: Muitos processos trabalhistas (> 10)
  - DIVIDA_ATIVA: Inscrito na dívida ativa da União
  - TITULOS_PROTESTADOS: Títulos em protesto
  - CND_NEGATIVA: Sem certidão negativa
  - EXECUCAO_FISCAL: Execuções fiscais em andamento
```

---

### Agent 6 — Doações Eleitorais (NOVO)

**Missão:** Mapear fluxo de dinheiro entre empresa/sócios e campanhas políticas.

**Fonte:** TSE — Prestação de Contas Eleitorais (download CSV)

**Lógica:**

```
INPUT: Entity (CPF ou CNPJ)

1. Buscar doações feitas pelo CNPJ ou CPF
2. Para cada doação:
   a. Candidato beneficiado
   b. Partido
   c. Valor
   d. Ano eleitoral
3. Cruzamento:
   - Candidato eleito contratou empresa do doador? (Agent 4)
   - Sócio do fornecedor doou para político que libera emendas
     para o município que contrata o fornecedor? (a lógica do Bruno César)

FINDINGS:
  - DOADOR_CAMPANHA: Fez doações eleitorais (informativo)
  - DOOU_PARA_CONTRATANTE: Doou para político ligado ao órgão que contrata
  - VOLUME_DOACOES: Alto volume de doações em múltiplos ciclos
```

---

### Agent 7 — Network Analyzer (NOVO — meta-agent)

**Missão:** Não consulta nenhuma base externa. Analisa o GRAFO já construído pelos outros agents e identifica padrões estruturais.

**Lógica:**

```
INPUT: O grafo completo construído pelos Agents 1-6

ANÁLISES:
1. Detecção de clusters:
   - Grupo de empresas com sócios em comum formando "cluster"
   - Cluster tem contratos com o mesmo órgão?

2. Detecção de laranjas:
   - Sócio PF com participação em 10+ empresas do mesmo ramo
   - Empresas com capital social mínimo mas contratos altos
   - Empresas no mesmo endereço com sócios diferentes

3. Detecção de triangulação:
   - A → B → C → A (ciclo no grafo)
   - Empresa A contrata empresa B, cujo sócio é parente do
     dono de A (via sobreposição de endereço ou sobrenome)

4. Análise temporal:
   - Empresa aberta pouco antes de licitação
   - Sócio entrou na sociedade pouco antes de contrato
   - Concentração de alterações societárias em período curto

5. Métricas de centralidade:
   - Betweenness centrality: quem são os nós que conectam clusters?
   - Degree centrality: quem tem mais conexões?
   - Nós com alta centralidade + flags de risco = investigar primeiro

FINDINGS:
  - CLUSTER_EMPRESARIAL: Grupo de empresas interconectadas
  - POSSIVEL_LARANJA: Padrão de pessoa laranja
  - TRIANGULACAO: Ciclo suspeito no grafo de relacionamentos
  - TIMING_SUSPEITO: Alterações societárias coincidentes com contratos
  - NO_CENTRAL: Pessoa/empresa é hub de conexões
```

---

## 4. Orquestrador (Investigation Loop)

O Orchestrator é o cérebro que coordena tudo:

```python
class Orchestrator:
    def __init__(self, config):
        self.agents = [
            QSADeepExplorer(),
            SanctionsScanner(),
            PEPAnalyzer(),
            ContratosAgent(),
            JudicialAgent(),
            DoacoesAgent(),
        ]
        self.network_analyzer = NetworkAnalyzer()  # roda no final
        self.graph = EntityGraph()
        self.queue = PriorityQueue()
        self.visited = set()
        self.config = config

    def investigate(self, cnpj: str) -> InvestigationResult:
        """
        Fluxo principal de investigação.
        """
        # 1. Seed: CNPJ do fornecedor
        seed = Entity(id=cnpj, type="CNPJ", depth=0, priority=1.0)
        self.queue.push(seed)

        # 2. Investigation loop
        while not self.queue.empty():
            # Checagens de segurança
            if len(self.visited) >= self.config.MAX_ENTITIES:
                break
            if elapsed_time() >= self.config.MAX_TIME:
                break

            entity = self.queue.pop()

            if entity.id in self.visited:
                continue
            if entity.depth > self.config.MAX_DEPTH:
                continue
            if entity.priority < self.config.RELEVANCE_THRESHOLD:
                continue

            self.visited.add(entity.id)

            # 3. Rodar agents relevantes
            # (nem todo agent roda para todo tipo de entidade)
            for agent in self.agents:
                if entity.type in agent.input_types:
                    result = agent.investigate(entity)

                    # Adicionar achados ao grafo
                    self.graph.add_findings(entity, result.findings)
                    self.graph.add_edges(result.edges)

                    # Novos leads vão para a fila
                    for lead in result.new_leads:
                        lead.depth = entity.depth + 1
                        if lead.id not in self.visited:
                            self.queue.push(lead)

            # 4. Emitir progresso (para o frontend via WebSocket)
            emit_progress(entity, self.graph.stats())

        # 5. Análise de rede (meta-agent)
        network_findings = self.network_analyzer.analyze(self.graph)
        self.graph.add_findings(None, network_findings)

        # 6. Calcular risk score final (graph-aware)
        risk = GraphAwareRiskScorer(self.graph).calculate()

        # 7. Gerar relatório
        return InvestigationResult(
            graph=self.graph,
            risk=risk,
            stats={
                "entities_investigated": len(self.visited),
                "total_findings": self.graph.total_findings(),
                "total_edges": self.graph.total_edges(),
                "time_elapsed": elapsed_time(),
                "agents_used": [a.name for a in self.agents],
            }
        )
```

### Estratégia de paralelismo

Os agents devem rodar em **paralelo por entidade** quando possível:

```
Para Entity "CPF 123.456.789-00":
  ┌─ Agent 2 (Listas)      ─┐
  ├─ Agent 3 (PEP)          ├─ executam em paralelo (asyncio)
  ├─ Agent 5 (Judicial)     │
  └─ Agent 6 (Doações)     ─┘
        │
        ▼
  Consolidar resultados + novos leads
        │
        ▼
  Próxima entidade da fila
```

O Agent 1 (QSA) geralmente roda primeiro porque é ele que gera os leads iniciais. Os demais podem rodar em paralelo para cada entidade.

**Rate limiting global:** Manter um semáforo por API para respeitar os limites:

```python
rate_limiters = {
    "portal_transparencia": AsyncLimiter(80, 60),   # 80 req/min
    "opencnpj": AsyncLimiter(30, 60),                # 30 req/min
    "datajud": AsyncLimiter(20, 60),                  # 20 req/min
}
```

---

## 5. Modelo de dados do grafo

### Nós (entidades)

```
Person (CPF)
├── name: str
├── cpf: str (mascarado no output)
├── depth: int
├── flags: list[Finding]
├── risk_contribution: float
└── metadata: dict

Company (CNPJ)
├── razao_social: str
├── cnpj: str
├── situacao: str
├── cnae: str
├── endereco: str
├── capital_social: float
├── data_abertura: date
├── flags: list[Finding]
├── risk_contribution: float
└── metadata: dict
```

### Arestas (relacionamentos)

```
SOCIO_DE          Person → Company   (qualificacao, data_entrada, data_saida)
ADMINISTRADOR_DE  Person → Company   (qualificacao, data_entrada)
CONTRATADO_POR    Company → Orgao    (valor, vigencia, modalidade)
DOOU_PARA         Person/Company → Candidato  (valor, ano)
MESMO_ENDERECO    Company → Company  (endereco)
PROCESSO_CONTRA   Person/Company → Tribunal  (numero, assunto, valor)
SANCIONADO_EM     Person/Company → Lista  (tipo, periodo, orgao)
SERVIDOR_DE       Person → Orgao  (cargo, data)
```

---

## 6. Onde buscar os dados (referência rápida)

### APIs com acesso direto

| Base | URL | Auth | Rate Limit |
|------|-----|------|-----------|
| OpenCNPJ | `api.opencnpj.org/{cnpj}` | Nenhuma | ~30/min |
| Portal Transparência | `portaldatransparencia.gov.br/api-de-dados` | Chave gratuita | 90/min |
| BrasilAPI | `brasilapi.com.br/api/cnpj/v1/{cnpj}` | Nenhuma | Variável |
| Casa dos Dados | `api.casadosdados.com.br` | Freemium | Variável |
| Querido Diário | `queridodiario.ok.org.br/api` | Nenhuma | - |
| DataJud | `datajud-wiki.cnj.jus.br` | Cadastro | 20/min |

### Downloads em massa (CSV/bulk)

| Base | URL | Frequência |
|------|-----|-----------|
| CNPJ completo (RF) | `dados.gov.br/dados/conjuntos-dados/cadastro-nacional-da-pessoa-juridica---cnpj` | Mensal |
| TSE (tudo) | `dadosabertos.tse.jus.br` | Por eleição |
| CEIS/CNEP/CEPIM | `portaldatransparencia.gov.br/download-de-dados` | Mensal |
| Trabalho Escravo | `portaldatransparencia.gov.br/download-de-dados` | Semestral |
| IBAMA Autos | `dadosabertos.ibama.gov.br` | Mensal |
| Acordos de Leniência | `portaldatransparencia.gov.br/download-de-dados` | Mensal |
| Base dos Dados | `basedosdados.org` (BigQuery) | Variável |
| Servidores | `portaldatransparencia.gov.br/download-de-dados` | Mensal |

### Consulta reversa CPF → Empresas

**Essa é a peça que falta no sistema atual.** Sem isso, você sabe quem são os sócios do fornecedor, mas não sabe em que OUTRAS empresas eles participam.

**Opções:**

1. **Base local da Receita Federal (~550GB):** Importar para PostgreSQL. Query: `SELECT * FROM socios WHERE cpf = '12345678901'`. Custo: armazenamento + processamento. Mas é o mais completo e confiável.

2. **Base dos Dados (BigQuery):** A tabela `br_me_cnpj.socios` permite query por CPF. Gratuito até 1TB/mês de processamento.

3. **CNPJs.rocks / Casa dos Dados:** APIs que fazem o reverse lookup. Verificar termos de uso e limites.

4. **OpenCNPJ (BigQuery mirror):** O próprio OpenCNPJ disponibiliza a base no BigQuery.

**Recomendação para o MVP:** Usar BigQuery (Base dos Dados ou OpenCNPJ). Para produção, manter base local atualizada mensalmente.

---

## 7. Sequência de implementação sugerida

### Fase 1 — Fundação (Semana 1-2)
- [ ] Implementar dataclasses (`Entity`, `Finding`, `Edge`, `AgentResult`)
- [ ] Implementar `EntityGraph` (pode começar com dict/NetworkX)
- [ ] Implementar `PriorityQueue` com deduplicação
- [ ] Implementar `Orchestrator` com investigation loop
- [ ] Refatorar Agent 1 para interface `BaseAgent`
- [ ] Adicionar reverse lookup de CPF (BigQuery ou API)

### Fase 2 — Agents Essenciais (Semana 2-3)
- [ ] Refatorar Agent 2 com todas as listas (CEIS, CNEP, CEPIM, CEAF, Trabalho Escravo)
- [ ] Refatorar Agent 3 com TSE (candidaturas + filiações)
- [ ] Implementar Agent 4 (Contratos & Licitações)
- [ ] Implementar Agent 5 (Judicial — ao menos DataJud)
- [ ] Asyncio: rodar agents em paralelo por entidade

### Fase 3 — Inteligência (Semana 3-4)
- [ ] Implementar Agent 6 (Doações Eleitorais)
- [ ] Implementar Agent 7 (Network Analyzer)
- [ ] Risk Scorer graph-aware (pondera não só flags, mas posição no grafo)
- [ ] Report Generator com visualização do grafo (D3.js / Sigma.js)

### Fase 4 — Produção (Semana 4-5)
- [ ] API FastAPI para servir as análises
- [ ] WebSocket para progresso em tempo real
- [ ] Fila de jobs (Celery/Redis) para análises longas
- [ ] Cache de resultados (evitar re-consultas)
- [ ] Dashboard de monitoramento contínuo
- [ ] Integração com o sistema de compliance FIUS

---

## 8. Considerações legais

**Tudo que está descrito aqui usa exclusivamente dados públicos abertos**, amparado por:

- Lei de Acesso à Informação (Lei 12.527/2011)
- Política de Dados Abertos (Decreto 8.777/2016)
- Marco Civil da Internet (Lei 12.965/2014)

**Atenção com a LGPD (Lei 13.709/2018):**

- Dados de sócios de empresas são dados públicos (QSA é registro público)
- CPFs devem ser tratados com finalidade legítima (due diligence / compliance)
- No output para o cliente, CPFs devem ser mascarados (***456.789-**)
- Manter registro de finalidade e base legal do tratamento
- Implementar rotina de exclusão mediante solicitação
- O relatório não deve ser redistribuído sem controle

**Recomendação:** Incluir disclaimer em todo relatório gerado e manter log de auditoria de quem consultou o quê.
