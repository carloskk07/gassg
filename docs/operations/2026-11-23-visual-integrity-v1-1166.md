# TAMÃO V1.1166 — segunda passada de integridade visual

Revisão direcionada após a V1.1165. Esta mudança não altera contratos de pagamento, saldos, comissões, autenticação, catálogo, disponibilidade ou reservas.

## Pontos verificados e corrigidos
- **Caronas #rides:** a fotografia de uma estrada litorânea foi substituída por foto gratuita do fotógrafo Pedro Fritsch, feita em Arroio Grande/RS e publicada no Unsplash. A página identifica crédito, localização e finalidade ilustrativa; a fotografia não implica carona ativa naquela rodovia. Fonte: https://unsplash.com/photos/a-highway-with-a-car-driving-down-the-middle-of-it-J5HTafFYXL8
- **Profissionais #professionals:** as seis especialidades (eletricista, encanador, pedreiro, pintor, diarista e jardineiro) recebem símbolos vetoriais relacionados às atividades, com indicadores de seleção e foco. Nenhum símbolo é sinal de homologação profissional ou de disponibilidade.
- **Profissionais / Agenda:** ícone decorativo de estrela no convite de agendamento vira calendário; a antiga estrela gigante no convite comercial vira monograma TAMÃO.
- **Caronas:** três sinais do bloco de confiança viram ícones estáveis, relacionados a revisão do anúncio, contato direto e decisão do usuário. Mensagens existentes preservadas.
- **Home:** cesta passa a usar um único ícone de marca; três cartões de vantagens e os painéis Clube/Rede também.
- **Agenda:** diferenciais dos participantes recebem marcadores discretos, consistentes na prévia e no site público, sem estrelas que pareçam avaliação de terceiros.
- **Mobilidade:** detalhes da solicitação continuam identificando Moto e Carro, mas sem emojis dependentes do sistema operacional.

## Testes de aceite
- `tests/discovery-visual-integrity-v1-1166.mjs` no Audit: proveniência fotográfica e alt/credit, seis categorias, estilos, preservação de consulta, contato e cadastro; Home/Agenda/Mobilidade.
- `tests/discovery-visual-browser-v1-1166.mjs` no smoke: Chrome 360/1280 px em Profissionais e Caronas, máscaras SVG visíveis, conteúdo, crédito da foto e ausência de overflow.
- Portas existentes: Audit global, orçamento de bundle, browser visual completo, Android offline, integração Supabase descartável.

## Limitações
Somente acabamentos confirmados nesta rodada: não presumir que todas as páginas de parceiro/Admin ou fotografias de todos os participantes estejam revisadas. O estabelecimento é responsável por suas próprias fotos, e a disponibilidade de caronas/profissionais continua derivada do backend. Nenhum ambiente real gera cobrança nesta revisão.
