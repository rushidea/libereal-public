import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { CART_ADDON_RULES } from '@/lib/cart-promotions/rules';
import { isRuleActive } from '@/lib/cart-promotions/detect';
import { attachDisplayPrices, resolveIsFormalMember } from '@/lib/product-display';
import { STOREFRONT_HIDDEN_HAZARDOUS } from '@/lib/product-visibility';

export const dynamic = 'force-dynamic';

/** 返回某换购规则的可换购产品清单（在售、有价、非危化）。 */
async function get(req: NextRequest, client: typeof prisma, formalMember: typeof resolveIsFormalMember) {
  const ruleId = req.nextUrl.searchParams.get('ruleId');
  const rule = CART_ADDON_RULES.find((r) => r.id === ruleId);
  if (!rule || !isRuleActive(rule)) {
    return NextResponse.json({ error: 'RULE_NOT_FOUND' }, { status: 404 });
  }

  if (rule.addonOptions?.length) {
    const optionByCatalog = new Map(rule.addonOptions.map((option) => [option.catalogNumber, option]));
    const products = await client.product.findMany({
      where: { AND: [
        { OR: [{ catalogNumber: { in: [...optionByCatalog.keys()] } }, { variants: { some: { catalogNumber: { in: [...optionByCatalog.keys()] } } } }] },
        ...(rule.addonBrand ? [{ brand: rule.addonBrand }] : []), { inStock: true }, { pricingMode: 'fixed' }, STOREFRONT_HIDDEN_HAZARDOUS,
      ] },
      select: { id: true, catalogNumber: true, brand: true, name: true, spec: true, salesUnit: true, price: true,
        originalPrice: true, imageUrl: true, inStock: true, stockQuantity: true, leadTime: true,
        variants: { select: { id: true, catalogNumber: true, spec: true, price: true, originalPrice: true,
          inventoryAccounts: { select: { availableQuantity: true }, take: 1 } } } },
      orderBy: { catalogNumber: 'asc' }, take: 60,
    });
    const choices = products.flatMap((product) => {
      const { variants, ...base } = product;
      const parentOption = optionByCatalog.get(product.catalogNumber);
      const parent = parentOption && Number.isFinite(parentOption.price) && parentOption.price >= 0 && Number.isSafeInteger(parentOption.quantity) && parentOption.quantity > 0
        && !variants.length && product.price > 0 && product.price * parentOption.quantity >= parentOption.price && (product.stockQuantity < 0 || product.stockQuantity >= parentOption.quantity)
        ? [{ ...base, addonOption: parentOption }] : [];
      const selectedVariants = variants.flatMap((variant) => {
        const option = optionByCatalog.get(variant.catalogNumber); const stock = variant.inventoryAccounts[0]?.availableQuantity ?? product.stockQuantity;
        if (!option || !Number.isFinite(option.price) || option.price < 0 || !Number.isSafeInteger(option.quantity) || option.quantity <= 0
          || variant.price <= 0 || variant.price * option.quantity < option.price || (stock >= 0 && stock < option.quantity)) return [];
        return [{ ...base, variantId: variant.id, catalogNumber: variant.catalogNumber, spec: variant.spec, price: variant.price,
          originalPrice: variant.originalPrice, stockQuantity: stock, addonOption: option }];
      });
      return [...parent, ...selectedVariants];
    });
    const isFormalMember = await formalMember();
    return NextResponse.json({ ruleId: rule.id, addonPrice: rule.addonPrice, products: attachDisplayPrices(choices, isFormalMember) });
  }

  const terms = rule.addonTerms.map((term) => ({ catalogNumber: { startsWith: term } }));
  const products = await client.product.findMany({
    where: { AND: [
      { OR: [...terms, { variants: { some: { OR: terms } } }] },
      ...(rule.addonBrand ? [{ brand: rule.addonBrand }] : []), { inStock: true }, { pricingMode: 'fixed' }, STOREFRONT_HIDDEN_HAZARDOUS,
    ] },
    select: { id: true, catalogNumber: true, brand: true, name: true, spec: true, salesUnit: true, price: true,
      originalPrice: true, imageUrl: true, inStock: true, stockQuantity: true, leadTime: true,
      variants: { select: { id: true, catalogNumber: true, spec: true, price: true, originalPrice: true,
        inventoryAccounts: { select: { availableQuantity: true }, take: 1 } } } },
    orderBy: { catalogNumber: 'asc' }, take: 60,
  });
  const choices = products.flatMap((product) => {
    const { variants, ...base } = product;
    const matches = (catalog: string) => rule.addonTerms.some((term) => catalog.startsWith(term));
    const parent = !variants.length && matches(product.catalogNumber) && product.price > 0 && product.price >= rule.addonPrice
      && (product.stockQuantity < 0 || product.stockQuantity >= 1) ? [base] : [];
    const selectedVariants = variants.flatMap((variant) => {
      const stock = variant.inventoryAccounts[0]?.availableQuantity ?? product.stockQuantity;
      if (!matches(variant.catalogNumber) || variant.price <= 0 || variant.price < rule.addonPrice || (stock >= 0 && stock < 1)) return [];
      return [{ ...base, variantId: variant.id, catalogNumber: variant.catalogNumber, spec: variant.spec, price: variant.price,
        originalPrice: variant.originalPrice, stockQuantity: stock }];
    });
    return [...parent, ...selectedVariants];
  });
  const isFormalMember = await formalMember();
  return NextResponse.json({ ruleId: rule.id, addonPrice: rule.addonPrice, products: attachDisplayPrices(choices, isFormalMember) });
}

const productionGet = (req: NextRequest) => get(req, prisma, resolveIsFormalMember);
export const GET = Object.assign(productionGet, {
  forTest: (req: NextRequest, client: typeof prisma, formalMember: typeof resolveIsFormalMember) => get(req, client, formalMember),
});
