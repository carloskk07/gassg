# TAMÃO V1.290 — diagnóstico do aparelho e inscrição idempotente

## Objetivo
Eliminar um risco no cadastro do push, facilitando a prova real da V1.289 sem ativar notificações de pedidos prematuramente.

## Melhorias implementadas
- Ao tocar **Verificar este aparelho**, a revenda vê apenas resultados locais: contexto HTTPS, compatibilidade Web Push, permissão de notificação, Service Worker ativo, inscrição local presente e compatibilidade com a chave pública VAPID atual.
- A tela informa claramente que um diagnóstico local **não comprova** que a inscrição foi gravada no servidor, nem que o aparelho recebeu uma notificação. Não apresenta endpoint de push, `p256dh`, segredo `auth` ou dados de clientes.
- O cadastro de aparelho agora reutiliza a assinatura local quando ela já possui a mesma chave VAPID. Antes, cada novo toque no botão cancelava a inscrição preexistente antes de confirmar o servidor, criando uma possibilidade desnecessária de perda de alertas.
- Apenas uma assinatura **nova** é cancelada após erro de cadastro no servidor. Uma inscrição preexistente válida é preservada durante indisponibilidade de rede.
- Se houver inscrição vinculada a outra chave VAPID, é solicitada renovação apenas após o toque explícito para cadastrar; não acontece troca automática de assinatura.
- O diagnóstico é vinculado à revenda atual e é limpo na troca de revenda ou logout. Não envia pedidos nem mexe na autorização da conta.

## Gates operacionais preservados
- `merchant_push_keyring.sender_enabled=false`
- `merchant_push_cron_config.enabled=false`
- Nenhum envio remoto ou aceitação do provedor foi comprovado: sem dispositivo de teste inscrito, não há prova de recebimento.
- O **teste remoto controlado** e seu registro por aparelho ainda não foram integrados. A tentativa de criação do registro servidor nesta rodada foi bloqueada pela camada de segurança da integração; não houve contorno desse bloqueio.

## Qualidade
- Regressão `tests/merchant-push-device-diagnostics-v1-290.mjs`: rede indisponível com inscrição existente, idempotência, troca de chave, diagnóstico, privacidade e autorização.
- Auditoria do repositório, build e verificação de publicação precisam passar antes do merge e da produção.

## Próximo passo físico
No Portal das Revendas, entrar pelo celular compatível, ativar alertas, cadastrar aparelho para teste e usar **Verificar este aparelho**. A confirmação de inscrição no servidor e o envio de um push real ficam para a etapa controlada após liberação do fluxo de teste e disponibilidade de um dispositivo real.
