# MGSL Trader Screen --- Phase 1

## Production Readiness Checklist

### Security

- [ ] RESTlet restricted to Trader roles — In NetSuite: edit the RESTlet deployment (`customdeploy_mcgi_rl_traderapi`), set **Audience > Roles** to Trader roles only.
- [ ] Suitelet access restricted — verify Suitelet deployment audience matches expected roles.
- [ ] No hardcoded subsidiary IDs — all come from `custscript_ts_subsidiary_id` script parameter.

### Performance

- [ ] Governance under threshold per cycle
- [ ] Payload size verified (detail payloads auto-split at >500KB)
- [ ] Delta fallback tested

### Operational

- [ ] Saved search IDs confirmed and have sort columns (required by `runPaged`)
- [ ] `custscript_ts_uom_config_json` finalized on RESTlet deployment (JSON, keyed by view name)
- [ ] `custscript_ts_html_file_id` set on Suitelet deployment if using file-ID approach (or verify `file.load` path works)
- [ ] Logging reduced for production
- [ ] Old Suitelet retained during UAT
