import { describe, expect, it } from 'vitest';
import { discoveriesNavItems, discoveriesNavOverview } from '@/data/discoveries';
import { researchTrendNavigation, researchTrendTopics } from '@/data/research-trends-navigation';

describe('discoveries navigation', () => {
  it('keeps the overview and discovery menu structure available', () => {
    expect(discoveriesNavOverview.href).toBe('/discoveries');
    expect(discoveriesNavItems.map((item) => item.id)).toEqual(['articles', 'journals', 'trends']);
    expect(discoveriesNavItems.every((item) => item.label)).toBe(true);
    expect(discoveriesNavOverview).not.toHaveProperty('description');
    expect(discoveriesNavItems.every((item) => !('description' in item))).toBe(true);
    expect(discoveriesNavItems[0].href).toBe('/discoveries');
    expect(discoveriesNavItems[1].href).toBe('/discoveries?tab=journals');
    expect(discoveriesNavItems[2]).toMatchObject({ id: 'trends', label: '研究热点' });
    expect(discoveriesNavItems[2]).not.toHaveProperty('href');
    expect(discoveriesNavItems[2].groups).toBe(researchTrendNavigation);
  });

  it('organizes all 43 topics into a three-level navigation tree', () => {
    const sections = researchTrendNavigation.flatMap((group) => group.sections);
    const topics = sections.flatMap((section) => section.topics);

    expect(researchTrendNavigation).toHaveLength(7);
    expect(sections).toHaveLength(18);
    expect(topics).toHaveLength(43);
    expect(researchTrendTopics).toHaveLength(43);
    expect(new Set(topics.map((topic) => topic.id)).size).toBe(43);
    expect(new Set(topics.map((topic) => topic.slug)).size).toBe(43);
    expect(topics.every((topic) => topic.href === `/research/trends/${topic.slug}`)).toBe(true);
    expect(topics.map((topic) => topic.id)).not.toContain('H013');
    expect(topics.map((topic) => topic.id)).not.toContain('H039');
  });

  it('preserves every published topic route', () => {
    expect(researchTrendTopics.filter((topic) => topic.status === 'published')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'H003', href: '/research/trends/ai-phenotyping-experimental-decision-support' }),
        expect.objectContaining({ id: 'H004', href: '/research/trends/long-read-pangenome-complex-variants' }),
        expect.objectContaining({ id: 'H005', href: '/research/trends/single-cell-regulatory-epigenomics' }),
        expect.objectContaining({ id: 'H006', href: '/research/trends/crispr-precision-editing-screening' }),
        expect.objectContaining({ id: 'H007', href: '/research/trends/single-cell-transcriptomics-perturbation-screening' }),
        expect.objectContaining({ id: 'H008', href: '/research/trends/spatial-transcriptomics-multiomics' }),
        expect.objectContaining({ id: 'H009', href: '/research/trends/single-cell-multimodal-in-situ-measurement' }),
        expect.objectContaining({ id: 'H010', href: '/research/trends/multiomics-network-biology' }),
        expect.objectContaining({ id: 'H011', href: '/research/trends/longitudinal-omics-dynamic-systems' }),
        expect.objectContaining({ id: 'H012', href: '/research/trends/biomedical-knowledge-graphs-data-standards' }),
        expect.objectContaining({ id: 'H016', href: '/research/trends/molecular-recording-lineage-tracing' }),
        expect.objectContaining({ id: 'H019', status: 'published' }),
        expect.objectContaining({ id: 'H020', status: 'published' }),
        expect.objectContaining({ id: 'H021', status: 'published' }),
        expect.objectContaining({ id: 'H022', href: '/research/trends/tumor-spatial-immunity' }),
        expect.objectContaining({ id: 'H023', href: '/research/trends/engineered-immune-cell-therapies' }),
        expect.objectContaining({ id: 'H024', href: '/research/trends/immune-checkpoints-combination-immunomodulation' }),
        expect.objectContaining({ id: 'H025', href: '/research/trends/tumor-heterogeneity-microenvironment-ecosystems' }),
        expect.objectContaining({ id: 'H026', href: '/research/trends/clonal-evolution-metastasis-drug-resistance' }),
        expect.objectContaining({ id: 'H027', href: '/research/trends/molecular-stratification-functional-oncology' }),
        expect.objectContaining({ id: 'H037', href: '/research/trends/liquid-biopsy-circulating-biomarkers' }),
        expect.objectContaining({ id: 'H034', href: '/research/trends/microbiome-metabolites-host-interactions' }),
        expect.objectContaining({ id: 'H035', href: '/research/trends/metabolic-inflammation-chronic-disease' }),
        expect.objectContaining({ id: 'H036', href: '/research/trends/obesity-fatty-liver-cardiometabolic-multiomics' }),
        expect.objectContaining({ id: 'H042', status: 'published' }),
        expect.objectContaining({ id: 'H017', href: '/research/trends/multi-organ-biological-aging-healthspan' }),
        expect.objectContaining({ id: 'H018', href: '/research/trends/organelle-interactions-ferroptosis' }),
        expect.objectContaining({ id: 'H028', href: '/research/trends/brain-cell-cross-scale-atlas' }),
        expect.objectContaining({ id: 'H029', href: '/research/trends/neurodegenerative-cell-atlas-mechanisms' }),
        expect.objectContaining({ id: 'H031', href: '/research/trends/pathogen-genomics-surveillance' }),
        expect.objectContaining({ id: 'H032', href: '/research/trends/vaccine-platforms-correlates-of-protection' }),
        expect.objectContaining({ id: 'H033', href: '/research/trends/antimicrobial-resistance-anti-infective-strategies' }),
        expect.objectContaining({ id: 'H041', href: '/research/trends/rna-lipid-nanoparticle-targeted-delivery' }),
        expect.objectContaining({ id: 'H030', href: '/research/trends/neural-interfaces-recording-neuromodulation' }),
        expect.objectContaining({ id: 'H038', href: '/research/trends/multiplex-ultrasensitive-molecular-diagnostics' }),
        expect.objectContaining({ id: 'H043', href: '/research/trends/decentralized-clinical-trials-digital-endpoints' }),
        expect.objectContaining({ id: 'H044', href: '/research/trends/real-world-evidence-target-trial-emulation' }),
        expect.objectContaining({ id: 'H045', href: '/research/trends/federated-clinical-data-precision-cohorts' }),
      ]),
    );
    expect(researchTrendTopics.filter((topic) => topic.status === 'published')).toHaveLength(43);
  });
});
