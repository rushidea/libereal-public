import { describe, expect, it } from 'vitest';
import { tracEngineeringKnowledge } from '@/data/knowledge/trac-engineering';
import {
  findForbiddenKnowledgeFields,
  isKnowledgeStagingEnabled,
  productMatchesKnowledgeCard,
} from '@/lib/knowledge-staging';

describe('knowledge staging guards', () => {
  it('requires both the staging environment and explicit feature flag', () => {
    expect(isKnowledgeStagingEnabled({
      KNOWLEDGE_STAGING_ENABLED: 'true',
      KNOWLEDGE_DEPLOYMENT_ENV: 'staging',
    })).toBe(true);
    expect(isKnowledgeStagingEnabled({
      KNOWLEDGE_STAGING_ENABLED: 'true',
      KNOWLEDGE_DEPLOYMENT_ENV: 'production',
    })).toBe(false);
    expect(isKnowledgeStagingEnabled({
      KNOWLEDGE_STAGING_ENABLED: 'false',
      KNOWLEDGE_DEPLOYMENT_ENV: 'staging',
    })).toBe(false);
  });

  it('requires exact product id, brand, catalog number and name', () => {
    const card = tracEngineeringKnowledge.products[0];
    const product = {
      id: card.productId,
      brand: card.brand,
      catalogNumber: card.catalogNumber,
      name: card.productName,
      hazardous: false,
    };

    expect(productMatchesKnowledgeCard(card, product)).toBe(true);
    expect(productMatchesKnowledgeCard(card, { ...product, catalogNumber: 'OTHER' })).toBe(false);
    expect(productMatchesKnowledgeCard(card, { ...product, hazardous: true })).toBe(false);
  });

  it('keeps transaction data outside the knowledge snapshot', () => {
    expect(findForbiddenKnowledgeFields(tracEngineeringKnowledge)).toEqual([]);
    expect(findForbiddenKnowledgeFields({ topic: { price: 10, stockQuantity: 2 } })).toEqual([
      'root.topic.price',
      'root.topic.stockQuantity',
    ]);
  });

  it('preserves the mandatory TRAC versus tracrRNA disambiguation', () => {
    const scaffold = tracEngineeringKnowledge.products.find((product) => product.mappingId === 'PM002');
    expect(scaffold?.displayLabel).toContain('不含 TRAC 靶向 crRNA');
    expect(scaffold?.mandatoryDisclaimer).toContain('并非人类 TRAC 基因位点');
    expect(scaffold?.productName).toBe('SygRNA ™ Cas9 合成 tracrRNA');
  });

  it('shows all four requirement states, including three empty requirements', () => {
    expect(tracEngineeringKnowledge.coverage).toHaveLength(4);
    expect(tracEngineeringKnowledge.coverage.filter((item) => item.status === 'no_candidate')).toHaveLength(3);
  });

  it('keeps all Phase 7 assets inside the approved internal review boundary', () => {
    expect(tracEngineeringKnowledge.seoAssets).toHaveLength(2);
    expect(tracEngineeringKnowledge.faqIntents).toHaveLength(4);

    for (const asset of tracEngineeringKnowledge.seoAssets) {
      expect(asset.indexingPolicy).toBe('noindex');
      expect(asset.publicationScope).toBe('internal_staging_only');
      expect(asset.reviewStatus).toBe('sol_approved');
    }

    for (const intent of tracEngineeringKnowledge.faqIntents) {
      expect(intent.productActionPolicy).toBe('view_only_no_recommendation');
      expect(intent.publicationScope).toBe('internal_staging_only');
      expect(intent.reviewStatus).toBe('sol_approved');
    }
  });

  it('inherits every release-level forbidden claim in each Phase 7 asset', () => {
    const expectedCodes = [
      'generic_therapeutic_target',
      'efficacy_marker',
      'persistence_marker',
      'clinical_release_criterion',
      'universal_outcome_improvement',
    ];
    const assets = [...tracEngineeringKnowledge.seoAssets, ...tracEngineeringKnowledge.faqIntents];

    for (const asset of assets) {
      expect([...asset.forbiddenClaimCodes]).toEqual(expectedCodes);
    }
  });

  it('requires direct product evidence whenever a Phase 7 asset cites a product mapping', () => {
    const assets = [...tracEngineeringKnowledge.seoAssets, ...tracEngineeringKnowledge.faqIntents];

    for (const asset of assets) {
      if (asset.productMappingIds.length > 0) {
        expect(asset.productEvidenceIds.length).toBeGreaterThan(0);
      }
    }
  });
});
