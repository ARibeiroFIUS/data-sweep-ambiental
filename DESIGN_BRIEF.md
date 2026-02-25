# Supply Risk Mapping — Design Brief

## Para o Designer: Pense na Experiência Completa

---

## 1. O que é o produto

Uma plataforma de due diligence automatizada que, a partir de um CNPJ, investiga em profundidade a empresa e todos os seus sócios, cruzando dezenas de bases públicas brasileiras. O output é um mapa de risco visual com score e recomendações.

**Usuários primários:**
- Advogados de compliance da FIUS
- Analistas de risco de empresas clientes
- Jornalistas investigativos (futuro, versão open source)

**Contexto de uso:** O advogado recebe um novo fornecedor para avaliar. Hoje ele entra manualmente em 5-10 sites, copia e cola dados, monta um parecer em Word. Leva horas. Com o Supply Risk Mapping, ele digita o CNPJ e em minutos tem o relatório completo.

---

## 2. Identidade visual

Seguir a identidade FIUS:

| Elemento | Valor |
|----------|-------|
| Dark Blue | `#001F3F` |
| Primary Blue | `#0088CC` |
| Accent Teal | `#00D4AA` |
| Warm Orange | `#FF6B35` |
| Fundo | Dark (#0A0F1C) |
| Ícones | Minimalist SVG line icons, sem emojis |
| Tipografia | Outfit |
| Efeitos | Glassmorphism, particle animations |

**Para níveis de risco, adicionar:**

| Nível | Cor | Uso |
|-------|-----|-----|
| CRITICO | `#FF0000` | Badges, borders, glow |
| ALTO | `#FF6B35` (Warm Orange) | Badges, borders |
| MEDIO | `#FFB800` | Badges, borders |
| BAIXO | `#00D4AA` (Accent Teal) | Badges, borders |

---

## 3. Jornada do usuário — Fluxo completo

### Tela 1: Dashboard (Home)

**O que o usuário vê ao abrir:**

- Barra de busca central, proeminente: "Digite o CNPJ do fornecedor"
- Abaixo: cards com as últimas análises realizadas (mini-cards com CNPJ, razão social, score, data)
- Sidebar ou topo: navegação para "Análises Recentes", "Monitoramento", "Batch"
- Canto: indicador de status das APIs (verdes = online, amarelo = degradado)

**Sensação desejada:** Controle, profissionalismo, confiança. O usuário deve sentir que está operando uma ferramenta poderosa, mas simples.

---

### Tela 2: Análise em andamento (a mais importante de todas)

**Essa tela é o coração da experiência.** O sistema leva de 30 segundos a 3 minutos para completar uma análise profunda. O designer precisa transformar essa espera em uma experiência informativa e até envolvente.

**O que acontece por baixo:** O Orchestrator está rodando 7 agents que fazem dezenas de requisições a APIs diferentes, descobrem novos leads, e expandem o grafo de investigação em tempo real.

**O que o usuário deve ver:**

**Área central — Grafo expandindo em tempo real:**
- Começa com um nó central (o CNPJ do fornecedor)
- À medida que sócios são descobertos, novos nós aparecem com animação suave
- Conexões (arestas) surgem entre nós com linhas animadas
- Nós mudam de cor conforme flags são encontrados:
  - Cinza neutro → sem flags ainda
  - Teal → limpo
  - Amarelo → flag médio encontrado
  - Laranja → flag alto
  - Vermelho com glow → flag crítico
- O grafo vai se expandindo organicamente. Novos "ramos" aparecem quando o agent descobre empresas dos sócios.

**Lateral direita — Feed de atividade:**
- Log em tempo real do que cada agent está fazendo:
  ```
  [QSA Explorer] Extraindo sócios de EMPRESA X LTDA...
  [QSA Explorer] 3 sócios encontrados. Investigando...
  [Sanctions]    Verificando JOÃO SILVA no CEIS... limpo
  [Sanctions]    Verificando MARIA SOUZA no CEIS... limpo
  [PEP]          JOÃO SILVA → servidor público federal detectado!
  [QSA Explorer] JOÃO SILVA é sócio de mais 4 empresas. Expandindo...
  [Contratos]    EMPRESA Y tem R$ 2.3M em contratos federais...
  ```
- Cada linha com ícone do agent e timestamp
- Linhas de alerta (flags encontrados) destacadas com cor e animação sutil

**Topo — Barra de progresso inteligente:**
- Não é uma barra linear (porque não sabemos quantas entidades serão descobertas)
- Mostrar: "X entidades investigadas | Y flags encontrados | Z bases consultadas"
- Indicador de profundidade atual: "Nível 2 de 3"

**Rodapé — Score provisório:**
- O risk score vai se atualizando em tempo real conforme novos findings chegam
- Número grande animado, com a cor do nível atual
- "Score provisório — análise em andamento"

**DETALHE CRÍTICO DE UX:** O usuário deve poder clicar em qualquer nó do grafo DURANTE a análise para ver os detalhes daquela entidade (mesmo que a análise completa ainda não tenha terminado).

---

### Tela 3: Resultado final

Quando a análise completa, a tela transiciona suavemente para o resultado.

**Layout sugerido — 3 zonas:**

**Zona A (topo): Score Card**
- Score grande (0-100) com o número em destaque
- Nível de risco com badge colorido
- Resumo em 2-3 linhas
- Botões: "Exportar PDF", "Exportar JSON", "Compartilhar", "Adicionar ao Monitoramento"

**Zona B (centro-esquerda): Grafo interativo**
- O grafo completo, agora estável (sem animação de expansão)
- Interativo: zoom, pan, clicar nos nós
- Ao clicar num nó: painel lateral abre com detalhes daquela entidade
- Filtros visuais: "Mostrar só flags", "Mostrar só conexões críticas", "Mostrar por agent"
- Legenda de cores e tipos de aresta

**Zona C (centro-direita): Detalhes estruturados**

Tabs ou accordion:

```
[Visão Geral] [Sócios] [Flags] [Listas] [PEP] [Contratos] [Judicial] [Doações]
```

Cada tab mostra os findings daquele agent de forma estruturada:

**Tab "Flags" (a mais usada):**
- Lista de findings ordenados por severidade (crítico primeiro)
- Cada finding é um card com:
  - Ícone de severidade
  - Título do flag
  - Descrição
  - Base de dados de origem
  - Entidade afetada (com link para o nó no grafo)

**Tab "Sócios":**
- Tabela com todos os sócios descobertos (não só os do QSA direto, mas os de 2º e 3º nível)
- Coluna de "distância" (nível 0, 1, 2, 3 do fornecedor original)
- Indicadores de flag por sócio (badges)
- Clicável: abre detalhes do sócio no painel lateral

**Tab "Contratos":**
- Timeline visual de contratos públicos
- Valores, órgãos, modalidades
- Destaque para dispensas de licitação e valores altos

---

### Tela 4: Monitoramento contínuo

Para fornecedores já analisados, o sistema pode rodar periodicamente e alertar sobre mudanças.

- Lista de fornecedores monitorados com score atual
- Timeline de mudanças: "Novo sócio detectado", "Empresa entrou no CEIS", "Novo processo judicial"
- Alertas por email/push quando score muda significativamente

---

### Tela 5: Análise Batch

Para quando o advogado precisa avaliar 50+ fornecedores de uma vez.

- Upload de planilha (CSV/XLSX) com lista de CNPJs
- Barra de progresso global + mini-visualização de cada análise
- Resultado: tabela rankeada por risk score (os mais arriscados primeiro)
- Heatmap visual: todos os fornecedores num mapa de calor risk-based
- Exportação: relatório consolidado (PDF/XLSX)

---

## 4. Microinterações que importam

**O grafo expandindo é a assinatura visual do produto.** É o que diferencia de uma "tabela com flags". O designer deve investir tempo especificamente nisso.

**Animações sugeridas:**
- Nó aparecendo: fade in + scale de 0 a 1 (spring easing)
- Aresta aparecendo: linha se desenha do nó de origem ao destino (path animation)
- Flag encontrado: nó pulsa brevemente com glow da cor do nível de risco
- Score atualizando: número faz flip animation (como placar)
- Análise concluída: partículas sutis (confetti suave para BAIXO, nada para ALTO/CRÍTICO)

**Feedback tátil:**
- Hover em nó do grafo: tooltip com resumo da entidade + highlight das conexões diretas
- Clique em nó: painel lateral desliza com detalhes completos
- Hover em flag: destaca no grafo a entidade e as conexões relevantes
- Drag no grafo: pan suave com inércia

**Estados de loading:**
- Skeleton screens (não spinners) para cada seção
- O grafo é o principal indicador de progresso — não precisa de spinner separado
- Se uma API está lenta: mostrar indicador no feed de atividade, não bloquear a UI

---

## 5. Componentes reutilizáveis para o Design System

| Componente | Uso |
|------------|-----|
| `RiskBadge` | Badge com cor do nível (BAIXO/MEDIO/ALTO/CRITICO) |
| `RiskScore` | Número grande circular com borda colorida |
| `EntityNode` | Nó do grafo (PF ou PJ, com indicador de flags) |
| `FindingCard` | Card de flag com severidade, título, descrição |
| `AgentActivityLine` | Linha do feed de atividade em tempo real |
| `EntityDetailPanel` | Painel lateral com detalhes de uma entidade |
| `ProgressHeader` | Barra de progresso com métricas (entidades, flags, bases) |
| `ConnectionLine` | Aresta do grafo com label do tipo de relacionamento |
| `StatusIndicator` | Indicador de status das APIs (online/offline) |
| `DataSourceTag` | Tag com nome da base de dados de origem |

---

## 6. Responsividade

**Desktop (primário):** Layout completo com grafo + detalhes lado a lado.

**Tablet:** Grafo em tela cheia, detalhes em drawer/bottom sheet ao tocar num nó.

**Mobile:** Lista de findings com mini-grafo no topo (simplificado). O grafo completo é pouco útil em mobile — priorizar a lista de flags e o score.

---

## 7. Acessibilidade

- Cores de risco devem ter ícones associados (não depender só de cor)
- Grafo deve ter modo tabular alternativo (para screen readers)
- Contraste mínimo WCAG AA em todos os textos
- Feed de atividade com role="log" para leitores de tela
- Atalhos de teclado para navegar entre findings

---

## 8. Referências visuais

Para inspiração de estilo e qualidade:

- **Maltego** (investigação de grafos de inteligência)
- **Palantir Gotham** (análise de redes de conexão)
- **Chainalysis Reactor** (rastreamento de criptomoedas — grafo interativo)
- **Neo4j Bloom** (visualização de grafos)
- **Linear.app** (para a qualidade do UI/UX geral, minimalismo)

O diferencial visual do produto deve ser: **escuro, profissional, com o grafo como protagonista e glassmorphism nos painéis sobrepostos.**

---

## 9. Copy & Tom de voz

O sistema lida com informações sensíveis. O tom deve ser:

- **Factual, nunca acusatório.** "Flag identificado" — não "suspeita de corrupção".
- **Técnico mas acessível.** O advogado precisa entender. "CEIS: Cadastro de Empresas Inidôneas" — sempre explicar siglas.
- **Cauteloso nos disclaimers.** "Este relatório é baseado em dados públicos e não constitui parecer jurídico."
- **Acionável.** Cada flag deve ter uma recomendação: "Verificar com o órgão X", "Solicitar documentação complementar".

**Nunca usar:** "corrupto", "criminoso", "laranja" (no output visível ao cliente). Usar: "flag de risco", "indicador", "ponto de atenção", "entidade interconectada".

---

## 10. Métricas de sucesso da experiência

| Métrica | Meta |
|---------|------|
| Tempo para iniciar análise | < 5 segundos após digitar CNPJ |
| Percepção de espera durante análise | "Informativa, não tediosa" (qualitativo) |
| Tempo para encontrar flag mais grave | < 10 segundos após análise concluir |
| Taxa de exportação de relatório | > 80% das análises geram export |
| NPS interno (advogados FIUS) | > 50 |
