# Auditoria v1.1 — Chama São Gabriel

Data: 01/10/2026

## Status

**READY_FOR_ONLINE_DEMO**

A versão está adequada para demonstração pública e validação de UX em um único navegador/perfil.

**NOT_READY_FOR_REAL_MULTIUSER_PILOT**

O bloqueador principal é arquitetural: a demonstração usa `localStorage`. Cliente e revenda em dispositivos diferentes ainda não compartilham pedidos, autenticação, pagamentos ou eventos por um backend comum.

## Gates obrigatórios

O deploy para GitHub Pages só pode ocorrer se todos estes gates passarem:

1. Sintaxe de todos os arquivos JavaScript.
2. Simulações de domínio e falhas.
3. Auditoria estática de assets e superfícies de confiança.
4. Smoke em Chrome headless no viewport móvel.
5. E2E real em Chrome: cesta → pedido → aceite → saída → chegada → PIN → settlement → cashback.
6. Manifest PWA válido.

## Evidência da rodada

- 32 simulações de domínio passaram.
- 9 assets referenciados pelo HTML foram validados.
- 12 referências de cache/service worker foram validadas.
- Rotas principais carregaram em Chrome headless a 360×800.
- E2E completo passou a 390×844.
- O E2E também verifica overflow horizontal, IDs duplicados, controles sem label, botões sem nome acessível, exceções JavaScript e payload XSS no endereço.
- Manifest PWA válido.

## Principais correções

- Removido P13 obrigatório de pedidos de água/carvão/lenha/gelo.
- Estado persistido versionado e migrável.
- Máquina de estados autoritativa para impedir transições fora de ordem.
- Apenas um pedido ativo por cliente na demonstração.
- Cesta e preço congelados no pedido.
- Reatribuição usa a cesta congelada, não o carrinho atual.
- Reatribuição mais cara exige novo aceite do cliente.
- Reatribuição mais barata preserva/refaz corretamente o cashback reservado.
- Cashback e recompensa são idempotentes.
- Estoque multiproduto é reservado somente após aceite.
- Preço de revenda expira após 24 horas sem reconfirmação.
- Aceite da revenda expira após 180 segundos.
- Atraso na confirmação de saída vira `AT_RISK`, sem falso “a caminho”.
- ETA vencido gera alerta explícito sem alterar artificialmente o status.
- PIN de entrega bloqueia após cinco tentativas incorretas.
- Inputs renderizados em HTML são escapados contra XSS.
- Valores persistidos corrompidos são normalizados.
- Revenda pausada deixa de receber novos pedidos; ofertas pendentes são reavaliadas.
- Sincronização entre abas do mesmo navegador via evento `storage`.
- Service worker/cache versionados e estratégia network-first.
- PWA manifest enriquecido.
- Cadastro adaptado ao CNPJ alfanumérico vigente desde julho de 2026.
- API interna de testes não é publicada por padrão.
- Textos demonstrativos não afirmam que parceiros fictícios já foram verificados.

## Limites conhecidos antes do piloto real

1. **Backend compartilhado:** substituir `localStorage` por banco/API em tempo real.
2. **Autenticação e autorização:** separar cliente, revenda, entregador e administrador no servidor.
3. **Geolocalização real:** endereço, área atendida, rota, distância e ETA ainda são demonstrativos.
4. **Parceiros reais:** cadastrar as três revendas reais, validar CNPJ/ANP, horários, estoque e catálogo.
5. **Pagamento real:** Pix/cartão/split/payout ainda não são processados.
6. **Notificações:** push/WhatsApp ainda não estão conectados.
7. **Trust Score:** regras existem no protótipo, mas precisam ser alimentadas por telemetria real.
8. **LGPD/termos/contratos:** necessários antes da operação pública com dados reais.
9. **Observabilidade:** backend futuro precisa de logs, alertas e auditoria server-side.

## Regra de release

Nenhuma mudança deve ser enviada para `main` se os gates de auditoria estiverem vermelhos.
