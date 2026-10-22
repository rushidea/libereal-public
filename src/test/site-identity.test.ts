import { describe, expect, it } from 'vitest';
import {
  SITE_DEFAULT_DESCRIPTION,
  SITE_FOOTER_SLOGAN,
  SITE_HOME_DESCRIPTION,
} from '@/lib/seo/site-identity';

const FORMER_FOOTER_SENTENCE =
  'LIBEREAL 由南京天放生物科技有限公司运营，面向生物、医学科研场景，连接实验路径、产品采购与技术支持。';

describe('site identity copy', () => {
  it('keeps the footer slogan separate from the default meta description', () => {
    expect(SITE_FOOTER_SLOGAN).toBe('与科研人同行，向未知更近一步。');
    expect(SITE_DEFAULT_DESCRIPTION).toBe(FORMER_FOOTER_SENTENCE);
    expect(SITE_HOME_DESCRIPTION.startsWith(FORMER_FOOTER_SENTENCE.replace(/。$/, '，'))).toBe(true);
    expect(SITE_HOME_DESCRIPTION).not.toBe(SITE_DEFAULT_DESCRIPTION);
  });
});
