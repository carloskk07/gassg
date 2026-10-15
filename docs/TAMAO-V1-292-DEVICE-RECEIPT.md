# TAMÃO V1.292 — Relato de recebimento do teste push

A revenda mantém o teste individual da V1.291. Depois de um teste **aceito pelo provedor**, aparecem duas ações simples: **Recebi a notificação** e **Não apareceu**. Ambas registram o **relato manual** do usuário, não uma comprovação criptográfica de recebimento. Se a notificação não chegou, não se afirma que chegou.

**Consultar último teste** busca o resultado das últimas 24 horas no servidor e permite retomar a confirmação após reabrir o portal ou fechar o PWA. Não há criação de pedidos fictícios.

## Autoridade e proteção
- JWT validado por `auth.getUser` e vínculo ativo à revenda.
- Assinatura push do próprio usuário e mesmo navegador identificada por hash SHA-256 do endpoint ativo.
- RPCs privadas acessíveis somente ao `service_role` depois da verificação Edge.
- Um registro por teste: primeira observação é imutável; repetir a mesma operação é idempotente; respostas contraditórias são rejeitadas.
- Testes anteriores a 24 horas não são elegíveis; apenas testes aceitos pelo provedor podem receber observações.
- Sem exposição de endpoints push, chaves do navegador, VAPID, nome/endereço de cliente ou dados de pedidos.
- Cron, `sender_enabled`, pedidos e comissões permanecem intocados.

## Verificação em dispositivo
1. Entre em https://parceiro.tamao.com.br usando uma conta da revenda.
2. Ative alertas, cadastre este aparelho e autorize notificações.
3. Envie um teste. Se o provedor aceitar, confira se o aviso apareceu, inclusive depois de fechar o PWA.
4. Escolha a opção correspondente à sua observação.
5. Reabra o portal, clique **Consultar último teste** e confira que o relato foi persistido.

Apenas um teste presencial comprova o comportamento observado no dispositivo; uma confirmação voluntária registrada no banco não implica funcionamento universal. O recebimento físico continua não comprovado enquanto não houver inscrições reais.
