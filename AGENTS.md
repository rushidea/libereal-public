# Public engineering workspace

This repository is rushidea/libereal-public. Develop generic application code, promotion/pricing engines, schemas and synthetic tests here.

Use the local .agents/skills/astra-orchestrator/SKILL.md for complex tasks when its trigger conditions match.

Never import legacy Git history, old branches/tags, private business configuration, supplier-specific formulas, real SKU/price/discount rules, supplier documents, real customer/order data, databases, secrets or deployment assets.

Public CI must run independently on GitHub-hosted runners without private repository checkout or commercial secrets. Use Node 20 as configured in .github/workflows/ci.yml.

Feature changes enter integration branches through pull requests. If staging-main is used, require the catalog/search/filter/promotion validation gate before merging. Production deployment is a separate private operation with an explicit human decision gate.

Private data and internal operations belong in rushidea/libereal-private. Do not use the legacy rushidea/libereal repository as the default development target.
