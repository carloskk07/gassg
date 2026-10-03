# TAMÃO — Runbook de lançamento

## Estado atual

- Marca pública: **TAMÃO**
- Assinatura: **Pediu? Tá na mão.**
- Domínio adquirido: `tamao.com.br`
- DNS/Cloudflare: aguardando liberação da alteração no Registro.br
- Comércio real: **fechado**
- Indexação: **bloqueada**
- Captação de clientes: pronta
- Captação de parceiros: pronta
- Canal de contato e privacidade: pronto
- Inbox administrativa de leads/solicitações: pronta

## Regra principal

**Não comprar tráfego para o domínio antes de DNS + HTTPS + formulário real passarem na verificação.**

O GitHub Pages continua sendo laboratório técnico. O domínio oficial será publicado via Cloudflare Pages.

## Cloudflare Pages — configuração preparada

Quando a alteração de nameservers estiver liberada:

1. Adicionar `tamao.com.br` à Cloudflare no plano Free.
2. Trocar na registradora os nameservers pelos dois fornecidos pela Cloudflare.
3. Criar um projeto Cloudflare Pages conectado a `carloskk07/gassg`.
4. Branch de produção: `main`.
5. Build command:
   `node scripts/build-public-site.mjs dist`
6. Output directory:
   `dist`
7. Adicionar os custom domains:
   - `tamao.com.br`
   - `www.tamao.com.br`
8. Validar HTTPS nos dois hosts.
9. Definir um único host canônico e redirecionar o outro.
10. Validar que nenhum diretório interno (`supabase/`, `tests/`, `scripts/`, `.github/`) foi publicado.

## Prova antes do primeiro anúncio

Executar em mobile e desktop:

- home abre em HTTPS;
- canonical aponta para `https://tamao.com.br/`;
- logo e favicon carregam;
- lista de abertura salva lead no Supabase;
- lead aparece no admin;
- landing de parceiro salva lead;
- parceiro aparece no admin;
- Privacidade abre;
- Termos abre;
- Contato envia solicitação;
- solicitação aparece no admin;
- refresh mantém PWA funcional;
- sem erro no console;
- sem overflow horizontal;
- sem conteúdo de simulação confundido com operação real.

## Indexação

Enquanto o domínio estiver em preparação:

- `meta robots = noindex,nofollow,noarchive,nosnippet`;
- `robots.txt = Disallow: /`.

Somente depois do domínio, HTTPS e conteúdo final passarem na prova:

- remover `noindex`;
- publicar robots para crawling;
- adicionar sitemap;
- validar Google Search Console;
- revisar metadata social final.

## Comércio real

A liberação de indexação e anúncios de pré-lançamento **não abre pedidos reais**.

Pedidos reais continuam dependentes dos gates server-side:

- admin ativo;
- primeira revenda real configurada;
- owner permanente;
- pagamento configurado;
- compliance aplicável;
- catálogo/estoque/preço frescos;
- capacidade de receber oferta agora;
- portais live atestados;
- ação administrativa explícita de go-live.

## Rollback

Se domínio, SSL, captação ou PWA falharem:

1. pausar anúncios;
2. manter comércio fechado;
3. voltar o domínio para página de manutenção ou build anterior;
4. corrigir;
5. repetir a prova de lançamento antes de retomar tráfego.


## Operação dos primeiros leads

Quando a captação pública começar, o admin deve ser tratado como uma fila operacional, não como arquivo de contatos.

### Cliente

1. `NOVO` — acabou de entrar.
2. `CONTATADO` — houve tentativa real de contato.
3. `QUALIFICADO` — confirmou interesse/região/categoria.
4. `CONVERTIDO` — virou cliente real quando a operação abrir.
5. `ENCERRADO` — sem continuidade; registrar motivo.

### Parceiro

Usar o mesmo pipeline, mas considerar `CONVERTIDO` somente quando a empresa efetivamente avançar para o onboarding real, não apenas por responder no WhatsApp.

### Contato e privacidade

- `NOVA` — ainda não tratada;
- `EM ANÁLISE` — alguém assumiu o caso;
- `RESOLVIDA` — houve solução documentada;
- `ENCERRADA` — fluxo finalizado.

Nunca marcar uma solicitação de privacidade como resolvida só por enviar uma mensagem inicial. A resolução deve refletir a providência efetivamente tomada.

### Disciplina de campanha

Não comparar campanhas somente por cliques. A métrica operacional inicial deve priorizar:

- leads novos;
- leads contatados;
- leads qualificados;
- leads convertidos;
- parceiros qualificados;
- origem/campanha de cada conversão.

Isso evita otimizar anúncios para volume de formulário sem valor comercial.
