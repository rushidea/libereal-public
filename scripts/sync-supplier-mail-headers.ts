async function main() {
  if (process.argv.slice(2).join(' ') !== '--once' || !process.env.DATABASE_PATH?.trim()) {
    console.error('仅允许显式指定 DATABASE_PATH 后执行 --once；不会启动自动轮询');
    process.exitCode = 1;
    return;
  }
  const { prisma } = await import('@/lib/prisma');
  try {
    const { syncSupplierMailHeadersOnce } = await import('@/lib/supplier-mail-headers');
    console.info(JSON.stringify(await syncSupplierMailHeadersOnce()));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(() => {
  console.error('收件头接续未完成，请核对配置、邮箱服务和原游标。');
  process.exitCode = 1;
});
