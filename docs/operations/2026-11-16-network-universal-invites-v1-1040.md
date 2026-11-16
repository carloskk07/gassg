# TAMÃO V1.1040 — Rede com convites para todos os módulos ativos

Decisão: um mesmo código pessoal de convite poderá apresentar todos os módulos ativos a clientes, revendas, motoristas, profissionais, usuários de caronas, participantes do Clube e anunciantes. **Não criar rede paralela** ou carteira adicional.

## Implementação
- Cliente em Rede → Minhas indicações escolhe a finalidade em um seletor, sem digitar dados.
- Revenda em Minha rede continua podendo convidar clientes e outras revendas e passa a convidar os demais públicos pelo seu próprio código.
- URL canônica `https://tamao.com.br/?ref=CODIGO#destino`, com destinos de rota permitidos: `home`, `merchants`, `mobility`, `advertise`, `rides`, `club`, `sponsors`.
- O `ref` permanece **na query antes do fragmento**, lida pela função `parseReferral()` já existente; preserva a regra de primeira origem e prazo local de até 30 dias. Códigos inválidos não geram convite atribuído.
- Hospedagens permanecem suspensas, portanto não devem receber links comerciais ativos.

## Não prometer comissão sem fato econômico
Essa alteração **expande o encaminhamento de convites**, não cria ainda novas fontes remuneráveis para publicidade, profissionais, caronas, cupons ou outros módulos; cada conversão ainda precisa ser reconhecida no servidor e cumprir as regras da modalidade. Links e cliques não são prova de transação, cadastro qualificado ou direito a dinheiro.

O motor existente dos 10% continua **exclusivo** para pacotes verificados de redução de taxas de revendas e moto/carro, e permanece desligado em produção até termos aprovados. A comissão direta de primeira compra, quando elegível, mantém regras próprias, sem duplicação. Taxas de outros módulos não podem ser incluídas automaticamente na base dos 10%.

## Próxima frente separada
Criar **registro canônico de conversões verificadas por tipo** (cliente, revenda, moto/carro, profissional, anúncio, carona, Clube) com consentimento, integridade de fonte, idempotência e atribuição à primeira origem válida. Somente depois, definir limites de bonificação sobre **receita pertencente ao TAMÃO** de cada modalidade. Não gerar remuneração por convite ou conversão não remunerável.

Testes: `node tests/network-universal-invites-v1-1040.mjs` + Audit/build/visual. Nenhuma migração, Pix, mudança de RLS ou publicação de termos nesta etapa.
