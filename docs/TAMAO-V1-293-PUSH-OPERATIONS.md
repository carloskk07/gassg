# TAMÃO V1.293 — Diagnóstico operacional do Web Push

## Funcionamento
No Portal das Revendas, **Verificar este aparelho** mantém as verificações locais da V1.290 (HTTPS, suporte Push, Service Worker, autorização do sistema, chave VAPID e inscrição). Quando os requisitos permitem, a mesma ação consulta um resumo privado dos testes deste aparelho dos **últimos 7 dias**, com:
- tentativas registradas
- aceites do provedor
- falhas de envio
- relatos voluntários de que o aviso apareceu ou não apareceu
- última falha classificada e próximo passo recomendado.

A consulta não envia notificações, não cria pedidos, não liga a fila automática e não lê pedidos, dados pessoais dos clientes nem informações financeiras.

## Regras de confiança
- A Edge Function valida o JWT real em `auth.getUser` e vínculo ativo da conta à revenda.
- A RPC `merchant_push_test_diagnostics` revalida associação do usuário e assinatura ativa do próprio aparelho através do hash SHA-256 de seu endpoint.
- O serviço retorna exclusivamente contadores e códigos de falha pré-definidos, não o endpoint, chaves do aparelho, chave VAPID ou dados de pedido.
- Não registrar resultado como recebido sem o relato manual; nem o relato é uma confirmação técnica da entrega.
- Os testes só são contabilizados após reserva válida no servidor: erros de autenticação, limite de taxa ou navegador podem não virar uma tentativa armazenada.
- Ausência de teste real em dispositivo significa **sem evidência de entrega real**.
- A verificação local continua funcional mesmo quando a consulta ao servidor falha.

## Orientações na interface
Permissão negada → habilitar nas configurações do navegador/sistema.
Service Worker ausente → recarregar o portal conectado.
Inscrição inexistente, chave divergente ou código SUBSCRIPTION_GONE → desativar e cadastrar push de novo.
Erro de gateway ou rede → conferir internet e repetir somente após o intervalo.
Aceite de provedor sem confirmação → conferir manualmente no aparelho.
Relato `not_seen` → verificar modo Não Perturbe, economia de bateria e notificações do sistema.
Relato `seen` → confirmar novamente com o PWA fechado.

## Retaguarda
O cron das notificações automáticas e o remetente de pedidos continuam desligados. A ativação dependerá de testes reais registrados em dispositivos das revendas.
