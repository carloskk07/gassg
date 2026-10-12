# TAMÃO — checkpoint privado, sem plano pago

**Esta rotina não migra o banco, não liga as vendas e não cria cadastros.**

No Windows 10/11, com as ferramentas cliente do PostgreSQL 17 instaladas,
execute no diretório do projeto (PowerShell):

```powershell
.\scripts\backup-tamao-windows.ps1 -CheckOnly
.\scripts\backup-tamao-windows.ps1
```

A primeira execução verifica se os executáveis `pg_dump` e `pg_restore`
existem. A segunda solicita a **senha do banco na própria máquina, de
forma oculta**, usa o host público registrado para o projeto TAMÃO e salva
um arquivo privado sob `%LOCALAPPDATA%\TAMAO\Backups`.
Se a sua conexão só oferece pooler IPv4, use os parâmetros `-HostName`,
`-Port` e `-UserName` com os valores do botão **Connect** do Supabase,
sem enviar a senha.

**Atenção:** o dump e seu SHA-256 não são prova de recuperação. Use
`scripts/release-db-restore-windows.ps1` primeiro com `-CheckOnly`;
depois restaure para um **PostgreSQL local separado e compatível** com as
extensões do Supabase, usando `-ConfirmIsolatedLocalPostgres`.
Uma instância comum do PostgreSQL pode não ter todas as extensões/roles.
A porta local nunca pode ser um túnel para produção.

Nunca anexe o backup ao GitHub, email, chats ou PRs. Não envie credenciais
nem senha ao assistente. A execução de migrations e deploy comercial deve
aguardar um relatório de recuperação completa com RLS, permissões e objetos.
