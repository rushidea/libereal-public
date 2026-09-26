export type SceneTheme = {
  pageBg: string;
  heroImage: string;
  heroIllustration?: string;
  heroOverlay: string;
  heroGlassPanel: string;
  heroGlassEyebrow: string;
  heroGlassTitle: string;
  heroGlassSummary: string;
  heroAsideBg: string;
  heroBorder: string;
  stepBadge: string;
  stepIcon: string;
  sectionIcon: string;
  softBg: string;
  softText: string;
  strongText: string;
  activeBorder: string;
  activeBg: string;
  hoverBorder: string;
  hoverBg: string;
  inputFocus: string;
  checkbox: string;
  primaryBtn: string;
  primaryBtnHover: string;
  tabActiveText: string;
  backLinkHover: string;
  cardHoverBorder: string;
  hintPanel: string;
  hintIcon: string;
  linkChip: string;
  linkChipHover: string;
};

export const sceneSurfaceClasses = {
  section: 'rounded-brand-lg border border-[var(--surface-border)] bg-[var(--surface-panel)] shadow-[var(--shadow-panel)]',
  subPanel: 'rounded-brand border border-[var(--surface-border)] bg-[var(--surface-muted)]',
  card: 'rounded-brand border border-[var(--surface-border)] bg-[var(--surface-panel)]',
  input: 'rounded-brand border border-[var(--surface-border)] bg-[var(--surface-input)] text-[var(--text-title)]',
  text: 'text-[var(--brand-color-text)]',
  mutedText: 'text-[var(--brand-color-text-secondary)]',
  focusRing: 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-color-focus-ring-readable)]',
} as const;

const lightHeroGlass = {
  heroGlassPanel: 'border-white/20 bg-white/20',
  heroGlassTitle:
    'text-gray-950 [text-shadow:0_1px_3px_rgba(255,255,255,0.95),0_0_10px_rgba(255,255,255,0.8)]',
  heroGlassSummary:
    'text-gray-900 [text-shadow:0_1px_2px_rgba(255,255,255,0.9),0_0_8px_rgba(255,255,255,0.7)]',
} satisfies Pick<SceneTheme, 'heroGlassPanel' | 'heroGlassTitle' | 'heroGlassSummary'>;

const darkHeroGlass = {
  heroGlassPanel: 'border-[#94a3b8]/50 bg-[#475569]/70 shadow-[0_16px_40px_rgba(71,85,105,0.28)]',
  heroGlassTitle:
    'text-[#f8fafc] [text-shadow:0_1px_3px_rgba(71,85,105,0.45),0_0_16px_rgba(71,85,105,0.25)]',
  heroGlassSummary:
    'text-[#cbd5e1] [text-shadow:0_1px_2px_rgba(71,85,105,0.38),0_0_12px_rgba(71,85,105,0.22)]',
} satisfies Pick<SceneTheme, 'heroGlassPanel' | 'heroGlassTitle' | 'heroGlassSummary'>;

const sceneBlueTheme: SceneTheme = {
  pageBg:
    'bg-gradient-to-b from-blue-50/90 via-slate-50 to-white dark:from-[#94a3b8]/40 dark:via-[#64748b]/50 dark:to-[#475569]',
  heroImage: '/images/scenes/western-blot-hero.svg',
  heroIllustration: '/images/scenes/western-blot-hero-photo.png',
  heroOverlay: 'bg-gradient-to-r from-white/92 via-blue-50/70 to-white/45',
  ...lightHeroGlass,
  heroGlassEyebrow: 'text-blue-900',
  heroAsideBg: 'bg-blue-50/40',
  heroBorder: 'border-blue-100',
  stepBadge: 'bg-blue-50 text-blue-700',
  stepIcon: 'text-blue-600',
  sectionIcon: 'text-blue-600',
  softBg: 'bg-blue-50',
  softText: 'text-blue-700',
  strongText: 'text-blue-900',
  activeBorder: 'border-blue-300',
  activeBg: 'bg-blue-50',
  hoverBorder: 'border-blue-200',
  hoverBg: 'hover:bg-blue-50/50',
  inputFocus: 'focus:border-blue-400 focus:outline-none',
  checkbox: 'text-blue-600 focus:ring-blue-500',
  primaryBtn: 'bg-blue-600',
  primaryBtnHover: 'hover:bg-blue-700',
  tabActiveText: 'text-blue-700',
  backLinkHover: 'hover:text-blue-600',
  cardHoverBorder: 'hover:border-blue-200',
  hintPanel: 'border-blue-100 bg-blue-50/60',
  hintIcon: 'text-blue-600',
  linkChip: 'text-blue-700',
  linkChipHover: 'hover:bg-blue-100',
};

const sceneGreenTheme: SceneTheme = {
  pageBg:
    'bg-gradient-to-b from-green-50/90 via-emerald-50/40 to-slate-50 dark:from-[#94a3b8]/40 dark:via-[#64748b]/50 dark:to-[#475569]',
  heroImage: '/images/scenes/elisa-hero.svg',
  heroIllustration: '/images/scenes/elisa-hero-photo.png',
  heroOverlay: 'bg-gradient-to-r from-white/92 via-emerald-50/70 to-white/45',
  ...lightHeroGlass,
  heroGlassEyebrow: 'text-green-900',
  heroAsideBg: 'bg-green-50/40',
  heroBorder: 'border-green-100',
  stepBadge: 'bg-green-50 text-green-700',
  stepIcon: 'text-green-600',
  sectionIcon: 'text-green-600',
  softBg: 'bg-green-50',
  softText: 'text-green-700',
  strongText: 'text-green-900',
  activeBorder: 'border-green-300',
  activeBg: 'bg-green-50',
  hoverBorder: 'border-green-200',
  hoverBg: 'hover:bg-green-50/50',
  inputFocus: 'focus:border-green-400 focus:outline-none',
  checkbox: 'text-green-600 focus:ring-green-500',
  primaryBtn: 'bg-green-600',
  primaryBtnHover: 'hover:bg-green-700',
  tabActiveText: 'text-green-700',
  backLinkHover: 'hover:text-green-600',
  cardHoverBorder: 'hover:border-green-200',
  hintPanel: 'border-green-100 bg-green-50/60',
  hintIcon: 'text-green-600',
  linkChip: 'text-green-700',
  linkChipHover: 'hover:bg-green-100',
};

const sceneRoseTheme: SceneTheme = {
  pageBg:
    'bg-gradient-to-b from-rose-50/85 via-slate-50 to-white dark:from-[#94a3b8]/40 dark:via-[#64748b]/50 dark:to-[#475569]',
  heroImage: '/images/scenes/elisa-hero.svg',
  heroIllustration: '/images/categories/subcategories/ihc-imaging-antibodies-v1.png',
  heroOverlay: 'bg-gradient-to-r from-white/94 via-rose-50/74 to-white/50',
  ...lightHeroGlass,
  heroGlassEyebrow: 'text-rose-950',
  heroAsideBg: 'bg-rose-50/35',
  heroBorder: 'border-rose-100',
  stepBadge: 'bg-rose-50 text-rose-700',
  stepIcon: 'text-rose-600',
  sectionIcon: 'text-rose-600',
  softBg: 'bg-rose-50',
  softText: 'text-rose-700',
  strongText: 'text-rose-900',
  activeBorder: 'border-rose-300',
  activeBg: 'bg-rose-50',
  hoverBorder: 'border-rose-200',
  hoverBg: 'hover:bg-rose-50/50',
  inputFocus: 'focus:border-rose-400 focus:outline-none',
  checkbox: 'text-rose-600 focus:ring-rose-500',
  primaryBtn: 'bg-rose-600',
  primaryBtnHover: 'hover:bg-rose-700',
  tabActiveText: 'text-rose-700',
  backLinkHover: 'hover:text-rose-600',
  cardHoverBorder: 'hover:border-rose-200',
  hintPanel: 'border-rose-100 bg-rose-50/60',
  hintIcon: 'text-rose-600',
  linkChip: 'text-rose-700',
  linkChipHover: 'hover:bg-rose-100',
};

const scenePurpleTheme: SceneTheme = {
  pageBg:
    'bg-gradient-to-b from-purple-50/80 via-slate-50 to-white dark:from-[#94a3b8]/40 dark:via-[#64748b]/50 dark:to-[#475569]',
  heroImage: '/images/scenes/elisa-hero.svg',
  heroIllustration: '/images/scenes/immunofluorescence-hero-photo.png',
  heroOverlay: 'bg-gradient-to-r from-white/94 via-purple-50/72 to-white/50',
  ...darkHeroGlass,
  heroGlassEyebrow: 'text-purple-100',
  heroAsideBg: 'bg-purple-50/35',
  heroBorder: 'border-purple-100',
  stepBadge: 'bg-purple-50 text-purple-700',
  stepIcon: 'text-purple-600',
  sectionIcon: 'text-purple-600',
  softBg: 'bg-purple-50',
  softText: 'text-purple-700',
  strongText: 'text-purple-900',
  activeBorder: 'border-purple-300',
  activeBg: 'bg-purple-50',
  hoverBorder: 'border-purple-200',
  hoverBg: 'hover:bg-purple-50/50',
  inputFocus: 'focus:border-purple-400 focus:outline-none',
  checkbox: 'text-purple-600 focus:ring-purple-500',
  primaryBtn: 'bg-purple-600',
  primaryBtnHover: 'hover:bg-purple-700',
  tabActiveText: 'text-purple-700',
  backLinkHover: 'hover:text-purple-600',
  cardHoverBorder: 'hover:border-purple-200',
  hintPanel: 'border-purple-100 bg-purple-50/60',
  hintIcon: 'text-purple-600',
  linkChip: 'text-purple-700',
  linkChipHover: 'hover:bg-purple-100',
};

const sceneAmberTheme: SceneTheme = {
  pageBg:
    'bg-gradient-to-b from-amber-50/85 via-slate-50 to-white dark:from-[#94a3b8]/40 dark:via-[#64748b]/50 dark:to-[#475569]',
  heroImage: '/images/scenes/elisa-hero.svg',
  heroIllustration: '/images/categories/subcategories/flow-cytometry-antibodies-v1.png',
  heroOverlay: 'bg-gradient-to-r from-white/94 via-amber-50/74 to-white/50',
  ...lightHeroGlass,
  heroGlassEyebrow: 'text-amber-950',
  heroAsideBg: 'bg-amber-50/35',
  heroBorder: 'border-amber-100',
  stepBadge: 'bg-amber-50 text-amber-700',
  stepIcon: 'text-amber-600',
  sectionIcon: 'text-amber-600',
  softBg: 'bg-amber-50',
  softText: 'text-amber-700',
  strongText: 'text-amber-900',
  activeBorder: 'border-amber-300',
  activeBg: 'bg-amber-50',
  hoverBorder: 'border-amber-200',
  hoverBg: 'hover:bg-amber-50/50',
  inputFocus: 'focus:border-amber-400 focus:outline-none',
  checkbox: 'text-amber-600 focus:ring-amber-500',
  primaryBtn: 'bg-amber-600',
  primaryBtnHover: 'hover:bg-amber-700',
  tabActiveText: 'text-amber-700',
  backLinkHover: 'hover:text-amber-600',
  cardHoverBorder: 'hover:border-amber-200',
  hintPanel: 'border-amber-100 bg-amber-50/60',
  hintIcon: 'text-amber-600',
  linkChip: 'text-amber-700',
  linkChipHover: 'hover:bg-amber-100',
};

const sceneCyanTheme: SceneTheme = {
  pageBg:
    'bg-gradient-to-b from-cyan-50/75 via-slate-50 to-white dark:from-[#94a3b8]/40 dark:via-[#64748b]/50 dark:to-[#475569]',
  heroImage: '/images/scenes/elisa-hero.svg',
  heroIllustration: '/images/categories/molecular-biology-v3.png',
  heroOverlay: 'bg-gradient-to-r from-white/94 via-cyan-50/72 to-white/50',
  ...lightHeroGlass,
  heroGlassEyebrow: 'text-cyan-950',
  heroAsideBg: 'bg-cyan-50/35',
  heroBorder: 'border-cyan-100',
  stepBadge: 'bg-cyan-50 text-cyan-700',
  stepIcon: 'text-cyan-600',
  sectionIcon: 'text-cyan-600',
  softBg: 'bg-cyan-50',
  softText: 'text-cyan-700',
  strongText: 'text-cyan-900',
  activeBorder: 'border-cyan-300',
  activeBg: 'bg-cyan-50',
  hoverBorder: 'border-cyan-200',
  hoverBg: 'hover:bg-cyan-50/50',
  inputFocus: 'focus:border-cyan-400 focus:outline-none',
  checkbox: 'text-cyan-600 focus:ring-cyan-500',
  primaryBtn: 'bg-cyan-600',
  primaryBtnHover: 'hover:bg-cyan-700',
  tabActiveText: 'text-cyan-700',
  backLinkHover: 'hover:text-cyan-600',
  cardHoverBorder: 'hover:border-cyan-200',
  hintPanel: 'border-cyan-100 bg-cyan-50/60',
  hintIcon: 'text-cyan-600',
  linkChip: 'text-cyan-700',
  linkChipHover: 'hover:bg-cyan-100',
};

const sceneIndigoTheme: SceneTheme = {
  ...sceneCyanTheme,
  pageBg:
    'bg-gradient-to-b from-indigo-50/80 via-slate-50 to-white dark:from-[#94a3b8]/40 dark:via-[#64748b]/50 dark:to-[#475569]',
  heroIllustration: '/images/categories/subcategories/flow-cytometry-reagents-v1.png',
  heroOverlay: 'bg-gradient-to-r from-white/94 via-indigo-50/72 to-white/50',
  heroGlassEyebrow: 'text-indigo-950',
  heroAsideBg: 'bg-indigo-50/35',
  heroBorder: 'border-indigo-100',
  stepBadge: 'bg-indigo-50 text-indigo-700',
  stepIcon: 'text-indigo-600',
  sectionIcon: 'text-indigo-600',
  softBg: 'bg-indigo-50',
  softText: 'text-indigo-700',
  strongText: 'text-indigo-900',
  activeBorder: 'border-indigo-300',
  activeBg: 'bg-indigo-50',
  hoverBorder: 'border-indigo-200',
  hoverBg: 'hover:bg-indigo-50/50',
  inputFocus: 'focus:border-indigo-400 focus:outline-none',
  checkbox: 'text-indigo-600 focus:ring-indigo-500',
  primaryBtn: 'bg-indigo-600',
  primaryBtnHover: 'hover:bg-indigo-700',
  tabActiveText: 'text-indigo-700',
  backLinkHover: 'hover:text-indigo-600',
  cardHoverBorder: 'hover:border-indigo-200',
  hintPanel: 'border-indigo-100 bg-indigo-50/60',
  hintIcon: 'text-indigo-600',
  linkChip: 'text-indigo-700',
  linkChipHover: 'hover:bg-indigo-100',
};

const sceneFuchsiaTheme: SceneTheme = {
  ...sceneRoseTheme,
  pageBg:
    'bg-gradient-to-b from-fuchsia-50/75 via-slate-50 to-white dark:from-[#94a3b8]/40 dark:via-[#64748b]/50 dark:to-[#475569]',
  heroIllustration: '/images/categories/subcategories/ihc-imaging-reagents-v1.png',
  heroOverlay: 'bg-gradient-to-r from-white/94 via-fuchsia-50/72 to-white/50',
  heroGlassEyebrow: 'text-fuchsia-950',
  heroAsideBg: 'bg-fuchsia-50/35',
  heroBorder: 'border-fuchsia-100',
  stepBadge: 'bg-fuchsia-50 text-fuchsia-700',
  stepIcon: 'text-fuchsia-600',
  sectionIcon: 'text-fuchsia-600',
  softBg: 'bg-fuchsia-50',
  softText: 'text-fuchsia-700',
  strongText: 'text-fuchsia-900',
  activeBorder: 'border-fuchsia-300',
  activeBg: 'bg-fuchsia-50',
  hoverBorder: 'border-fuchsia-200',
  hoverBg: 'hover:bg-fuchsia-50/50',
  inputFocus: 'focus:border-fuchsia-400 focus:outline-none',
  checkbox: 'text-fuchsia-600 focus:ring-fuchsia-500',
  primaryBtn: 'bg-fuchsia-600',
  primaryBtnHover: 'hover:bg-fuchsia-700',
  tabActiveText: 'text-fuchsia-700',
  backLinkHover: 'hover:text-fuchsia-600',
  cardHoverBorder: 'hover:border-fuchsia-200',
  hintPanel: 'border-fuchsia-100 bg-fuchsia-50/60',
  hintIcon: 'text-fuchsia-600',
  linkChip: 'text-fuchsia-700',
  linkChipHover: 'hover:bg-fuchsia-100',
};

const sceneEmeraldTheme: SceneTheme = {
  ...sceneGreenTheme,
  pageBg:
    'bg-gradient-to-b from-emerald-50/80 via-slate-50 to-white dark:from-[#94a3b8]/40 dark:via-[#64748b]/50 dark:to-[#475569]',
  heroIllustration: '/images/categories/subcategories/cell-culture-reagents-v1.png',
  heroOverlay: 'bg-gradient-to-r from-white/94 via-emerald-50/72 to-white/50',
  heroGlassEyebrow: 'text-emerald-950',
  heroAsideBg: 'bg-emerald-50/35',
  heroBorder: 'border-emerald-100',
};

const sceneElispotTheme: SceneTheme = {
  ...sceneGreenTheme,
  heroIllustration: '/images/scenes/elispot-fluorospot-hero-photo.png',
};

const sceneMagneticCellSeparationTheme: SceneTheme = {
  ...sceneAmberTheme,
  heroIllustration: '/images/scenes/magnetic-cell-separation-hero-photo-v2.png',
};

const sceneSingleCellOmicsTheme: SceneTheme = {
  ...sceneIndigoTheme,
  heroIllustration: '/images/scenes/single-cell-omics-hero-photo.png',
};

const sceneSpatialBiologyTheme: SceneTheme = {
  ...sceneFuchsiaTheme,
  heroIllustration: '/images/scenes/spatial-biology-hero-photo.png',
};

const sceneOrganoid3dCultureTheme: SceneTheme = {
  ...sceneEmeraldTheme,
  heroIllustration: '/images/scenes/organoid-3d-culture-hero-photo.png',
};

const sceneCrisprGeneEditingTheme: SceneTheme = {
  ...sceneCyanTheme,
  heroIllustration: '/images/scenes/crispr-gene-editing-hero-photo.png',
};

const sceneExtracellularVesiclesTheme: SceneTheme = {
  ...sceneEmeraldTheme,
  heroIllustration: '/images/scenes/extracellular-vesicles-hero-photo.png',
};

const sceneProteomicsMassSpecTheme: SceneTheme = {
  ...sceneBlueTheme,
  heroIllustration: '/images/scenes/proteomics-mass-spec-hero-photo.png',
};

const sceneSmallAnimalImagingTheme: SceneTheme = {
  ...sceneIndigoTheme,
  pageBg:
    'bg-gradient-to-b from-sky-50/80 via-slate-50 to-white dark:from-[#94a3b8]/40 dark:via-[#64748b]/50 dark:to-[#475569]',
  heroIllustration: '/images/scenes/small-animal-imaging-hero-photo.png',
  heroOverlay: 'bg-gradient-to-r from-white/94 via-sky-50/70 to-white/46',
  heroGlassEyebrow: 'text-sky-950',
  heroAsideBg: 'bg-sky-50/35',
  heroBorder: 'border-sky-100',
  stepBadge: 'bg-sky-50 text-sky-700',
  stepIcon: 'text-sky-600',
  sectionIcon: 'text-sky-600',
  softBg: 'bg-sky-50',
  softText: 'text-sky-700',
  strongText: 'text-sky-900',
  activeBorder: 'border-sky-300',
  activeBg: 'bg-sky-50',
  hoverBorder: 'border-sky-200',
  hoverBg: 'hover:bg-sky-50/50',
  inputFocus: 'focus:border-sky-400 focus:outline-none',
  checkbox: 'text-sky-600 focus:ring-sky-500',
  primaryBtn: 'bg-sky-600',
  primaryBtnHover: 'hover:bg-sky-700',
  tabActiveText: 'text-sky-700',
  backLinkHover: 'hover:text-sky-600',
  cardHoverBorder: 'hover:border-sky-200',
  hintPanel: 'border-sky-100 bg-sky-50/60',
  hintIcon: 'text-sky-600',
  linkChip: 'text-sky-700',
  linkChipHover: 'hover:bg-sky-100',
};

const sceneThemes: Record<string, SceneTheme> = {
  'western-blot': sceneBlueTheme,
  elisa: sceneGreenTheme,
  'elispot-fluorospot': sceneElispotTheme,
  ihc: sceneRoseTheme,
  immunofluorescence: scenePurpleTheme,
  'magnetic-cell-separation': sceneMagneticCellSeparationTheme,
  'flow-cytometry': sceneAmberTheme,
  'single-cell-omics': sceneSingleCellOmicsTheme,
  'spatial-biology': sceneSpatialBiologyTheme,
  'organoid-3d-culture': sceneOrganoid3dCultureTheme,
  'crispr-gene-editing': sceneCrisprGeneEditingTheme,
  'extracellular-vesicles': sceneExtracellularVesiclesTheme,
  'proteomics-mass-spec': sceneProteomicsMassSpecTheme,
  'small-animal-imaging': sceneSmallAnimalImagingTheme,
  'molecular-biology': sceneCyanTheme,
};

function standardizeSceneTheme(theme: SceneTheme): SceneTheme {
  return {
    ...theme,
    heroAsideBg: `${theme.heroAsideBg} dark:bg-[var(--surface-panel)]`,
    stepBadge: `${theme.stepBadge} dark:bg-[var(--surface-badge)] dark:text-[var(--brand-color-text-interactive)]`,
    stepIcon: `${theme.stepIcon} dark:text-[var(--brand-color-text-interactive)]`,
    sectionIcon: `${theme.sectionIcon} dark:text-[var(--brand-color-text-interactive)]`,
    softBg: `${theme.softBg} dark:bg-[var(--surface-muted)]`,
    softText: `${theme.softText} dark:text-[var(--brand-color-text-interactive)]`,
    strongText: `${theme.strongText} dark:text-[var(--brand-color-text)]`,
    activeBorder: `${theme.activeBorder} dark:border-[var(--brand-color-primary-border)]`,
    activeBg: `${theme.activeBg} dark:bg-[var(--surface-active)]`,
    hoverBorder: `${theme.hoverBorder} dark:hover:border-[var(--brand-color-primary-border)]`,
    hoverBg: `${theme.hoverBg} dark:hover:bg-[var(--surface-hover)]`,
    inputFocus: `${theme.inputFocus} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-color-focus-ring-readable)]`,
    checkbox: `${theme.checkbox} focus-visible:ring-[var(--brand-color-focus-ring-readable)]`,
    tabActiveText: `${theme.tabActiveText} dark:text-[var(--brand-color-text-interactive)]`,
    backLinkHover: `${theme.backLinkHover} dark:hover:text-[var(--brand-color-text-interactive-hover)]`,
    cardHoverBorder: `${theme.cardHoverBorder} dark:hover:border-[var(--brand-color-primary-border)]`,
    hintPanel: `${theme.hintPanel} dark:border-[var(--surface-border)] dark:bg-[var(--surface-panel)]`,
    hintIcon: `${theme.hintIcon} dark:text-[var(--brand-color-text-interactive)]`,
    linkChip: `${theme.linkChip} dark:text-[var(--brand-color-text-interactive)]`,
    linkChipHover: `${theme.linkChipHover} dark:hover:bg-[var(--surface-hover)]`,
  };
}

export function getSceneTheme(slug: string): SceneTheme {
  return standardizeSceneTheme(sceneThemes[slug] ?? sceneBlueTheme);
}
