# Status Vital

Página pública de status dos produtos da Vital (`https://status.vitalerp.tech`), gerada de forma estática com Node 22 + TypeScript e publicada no GitHub Pages.

## Como funciona

O workflow em [`.github/workflows/sonda.yml`](.github/workflows/sonda.yml) é dividido em dois jobs com permissões mínimas:

```
[GitHub Actions (cron 5 min)]
        |
  Job 1: sonda (contents: write)
        |-- restaura state.json da branch órfã "data"
        |-- npm run probe (verifica urlControle; se ok, consulta status.config.json)
        |       |-- aplica anti-oscilação (2 falhas seguidas)
        |       |-- abre/fecha incidentes e envia aviso no Telegram
        |       '-- grava data/state.json -> push --force na branch "data"
        |-- npm run build (data/state.json + content/*.md -> dist/)
        '-- envia artefato do Pages (actions/upload-pages-artifact)
        |
  Job 2: publicar (pages: write, id-token: write, environment: github-pages)
        '-- deploy no GitHub Pages (status.vitalerp.tech)
```

O histórico das sondas fica isolado na branch órfã `data` (arquivo `state.json`), mantendo a `main` limpa e sem commits automáticos (e o push em `data` não dispara o workflow novamente).

## Como rodar localmente

```bash
npm ci
npm run probe -- --dry   # testa as checagens sem gravar estado nem enviar Telegram
npm run build            # gera o site estático em dist/
npm test                 # executa a suíte de testes (vitest)
npm run typecheck        # verifica os tipos (tsc --noEmit)
```

Para gravar localmente em `data/state.json` sem disparar mensagens no Telegram:

```bash
SEM_TELEGRAM=1 npm run probe
```

## Como adicionar um componente

Edite `status.config.json` dentro do grupo desejado (ou crie um novo grupo):

```json
{
  "id": "erp-novo",
  "nome": "Novo serviço",
  "descricao": "Descrição curta exibida ao usuário",
  "url": "https://exemplo.vitalerp.tech/health",
  "esperado": 200,
  "json": { "caminho": "status", "em": ["ok"] },
  "latenciaMaxMs": 4000
}
```

- Sem `esperado` nem `json`, qualquer resposta HTTP 2xx é aceita.
- Quando `json` está definido sem `esperado`, o corpo JSON é avaliado mesmo em HTTP 503.

## Manutenção programada e incidente manual

1. Copie o modelo correspondente:
   - `content/manutencoes/_modelo.md.exemplo` para `content/manutencoes/AAAA-MM-DD-nome.md`
   - `content/incidentes/_modelo.md.exemplo` para `content/incidentes/AAAA-MM-DD-nome.md`
2. Preencha o frontmatter (`componentes` aceita IDs de componente ou ID de grupo, como `erp`).
3. Datas no formato `AAAA-MM-DD HH:mm` são interpretadas no horário de Brasília (UTC-03:00); datas ISO com fuso também são aceitas.
4. Faça commit e push na `main`. O workflow executa imediatamente e publica a atualização.

## Secrets do repositório

Configure em **Settings > Secrets and variables > Actions**:

| Secret | Obrigatório | Descrição |
| --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | Sim (para alertas) | Token do bot criado no `@BotFather`. |
| `ALERT_CHAT_ID` | Sim (para alertas) | ID do chat, grupo ou canal de destino. |
| `ALERT_THREAD_ID` | Não | ID do tópico (quando o grupo usa tópicos). |

Se os secrets do Telegram não estiverem definidos, a sonda continua rodando normalmente sem enviar mensagens.

## Como o Telegram é usado

Os alertas são disparados **apenas em mudança de estado** (abertura, mudança de gravidade e normalização do incidente) em texto puro, sem emojis e sem expor URLs internas de health check ou tokens. Se um envio falhar, a sonda tenta reenviar o aviso pendente na próxima execução.

## Publicação no GitHub Pages

1. Crie o repositório público no GitHub e envie a branch `main`.
2. Em **Settings > Pages**, selecione **Source: GitHub Actions**.
3. No provedor de DNS do domínio `vitalerp.tech`, crie um registro `CNAME` para `status` apontando para `<usuario-ou-org>.github.io`.
4. Em **Settings > Pages > Custom domain**, confirme `status.vitalerp.tech` (o arquivo `site/CNAME` já define o domínio) e marque **Enforce HTTPS**.

## Limitações conhecidas

- O `schedule` (`cron`) do GitHub Actions é *best-effort*: em horários de maior carga do GitHub, uma rodada pode atrasar alguns minutos.
- **O GitHub desativa workflows agendados de repositório público após 60 dias sem atividade** (commits, PRs ou execuções manuais): se a página passar a exibir o aviso de verificações atrasadas, abra a aba **Actions** no repositório e reative o workflow (ou execute manualmente via *Run workflow*).
- Se o próprio runner do GitHub Actions ficar sem acesso à internet (falha na checagem de `padroes.urlControle`), a sonda ignora a rodada e preserva o estado anterior, evitando alarme falso de queda geral.
- Com intervalo de 5 minutos e `falhasParaConfirmar: 2`, a detecção de incidentes leva até ~10 minutos por escolha, para evitar alarmes falsos por oscilação momentânea.
