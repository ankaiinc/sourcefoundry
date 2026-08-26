# Database trust certificates

`supabase-prod-ca-2021.crt` is Supabase's public root certificate for hosted PostgreSQL connections. SourceFoundry's Fly deployment uses it to verify the database certificate for API, worker, and release-migration connections.

- Source: <https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt>
- Subject: `Supabase Root 2021 CA`
- SHA-256: `80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA`
- Valid until: 2031-04-26

Before replacing this file, download the current certificate from the database provider over HTTPS, verify its subject, validity, and published fingerprint, update this record, and prove a release migration against production without disabling certificate verification.
