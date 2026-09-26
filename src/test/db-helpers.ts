// 测试辅助：建 SQLite DB（in-memory 共享）+ 真实 schema + seed 数据
// 关键：route handler 内部 `new Database(process.env.DATABASE_PATH)` 也要指向同一文件
// vitest `env` 在 worker 启动时设 DATABASE_PATH；这个 module 只需读它

import Database from 'better-sqlite3';

let _db: Database.Database | null = null;

export function getTestDb(): Database.Database {
  if (_db) return _db;
  const dbPath = process.env.DATABASE_PATH!;
  _db = new Database(dbPath);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');

  // 关键表（按 libereal schema 完整定义）
  _db.exec(`
    CREATE TABLE IF NOT EXISTS User (
      id TEXT PRIMARY KEY,
      name TEXT,
      email TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL DEFAULT 'customer',
      tier TEXT NOT NULL DEFAULT 'standard',
      points INTEGER NOT NULL DEFAULT 0,
      phone TEXT,
      phoneVerifiedAt DATETIME,
      phoneLastChangedAt DATETIME,
      institution TEXT,
      department TEXT,
      institutionType TEXT,
      institutionName TEXT,
      institutionUnit TEXT,
      institutionFacility TEXT,
      identity TEXT,
      advisorName TEXT,
      advisorPhone TEXT,
      school TEXT,
      college TEXT,
      major TEXT,
      building TEXT,
      piLab TEXT,
      affiliatedLab TEXT,
      resetToken TEXT,
      resetTokenExpiry DATETIME,
      googleEmail TEXT,
      alipayId TEXT,
      isNewUser INTEGER NOT NULL DEFAULT 1,
      isBlacklisted INTEGER NOT NULL DEFAULT 0,
      isFrozen INTEGER NOT NULL DEFAULT 0,
      avatar TEXT,
      alipayAvatar TEXT,
      alipayNickname TEXT,
      alipayGender TEXT,
      alipayCity TEXT,
      alipayProvince TEXT,
      wechatNickname TEXT,
      sex INTEGER,
      displayAvatarUrl TEXT,
      emailVerified DATETIME,
      password TEXT,
      approvalStatus TEXT DEFAULT 'approved',
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL,
      discountRate REAL,
      brandDiscounts TEXT,
      sourceTemplateId TEXT,
      legalAcceptedAt DATETIME,
      legalAcceptedIds TEXT,
      legalAcceptedSnapshot TEXT
    );
    CREATE TABLE IF NOT EXISTS Account (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      type TEXT NOT NULL,
      provider TEXT NOT NULL,
      providerAccountId TEXT NOT NULL,
      refresh_token TEXT,
      access_token TEXT,
      expires_at INTEGER,
      token_type TEXT,
      scope TEXT,
      id_token TEXT,
      session_state TEXT,
      UNIQUE(provider, providerAccountId)
    );
    CREATE TABLE IF NOT EXISTS AdminRole (
      id TEXT PRIMARY KEY,
      key TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT,
      isSystem INTEGER NOT NULL DEFAULT 1,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL
    );
    CREATE TABLE IF NOT EXISTS AdminPermission (
      id TEXT PRIMARY KEY,
      key TEXT NOT NULL UNIQUE,
      resource TEXT NOT NULL,
      action TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT
    );
    CREATE TABLE IF NOT EXISTS AdminRolePermission (
      roleId TEXT NOT NULL,
      permissionId TEXT NOT NULL,
      PRIMARY KEY (roleId, permissionId)
    );
    CREATE TABLE IF NOT EXISTS AdminUserRole (
      userId TEXT NOT NULL,
      roleId TEXT NOT NULL,
      assignedBy TEXT,
      assignedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (userId, roleId)
    );
    CREATE TABLE IF NOT EXISTS AdminMfaSetting (
      id TEXT PRIMARY KEY,
      scenarios TEXT NOT NULL,
      updatedByEmail TEXT,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL
    );
    CREATE TABLE IF NOT EXISTS AuditLog (
      id TEXT PRIMARY KEY,
      actorId TEXT,
      actorEmail TEXT,
      action TEXT NOT NULL,
      resource TEXT NOT NULL,
      targetType TEXT NOT NULL,
      targetId TEXT,
      beforeData TEXT,
      afterData TEXT,
      reason TEXT,
      metadata TEXT,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS TransientEntry (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      expiresAt DATETIME NOT NULL,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL
    );
    CREATE TABLE IF NOT EXISTS BackgroundTask (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      payload TEXT NOT NULL,
      result TEXT,
      priority INTEGER NOT NULL DEFAULT 0,
      attempts INTEGER NOT NULL DEFAULT 0,
      maxAttempts INTEGER NOT NULL DEFAULT 3,
      lastError TEXT,
      runAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      lockedAt DATETIME,
      lockedBy TEXT,
      completedAt DATETIME,
      dedupeKey TEXT UNIQUE,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL
    );
    CREATE TABLE IF NOT EXISTS VerificationToken (
      identifier TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      expires DATETIME NOT NULL,
      UNIQUE(identifier, token)
    );
    CREATE TABLE IF NOT EXISTS DiscountTemplate (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      discountRate REAL,
      brandDiscounts TEXT,
      description TEXT,
      createdAt DATETIME NOT NULL,
      updatedAt DATETIME NOT NULL
    );
    CREATE TABLE IF NOT EXISTS PointsLog (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      delta INTEGER NOT NULL,
      type TEXT NOT NULL,
      reason TEXT,
      relatedId TEXT,
      undoOfId TEXT UNIQUE,
      adminEmail TEXT,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS PointsProduct (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      imageUrl TEXT,
      pointsCost INTEGER NOT NULL,
      stock INTEGER NOT NULL DEFAULT 0,
      category TEXT NOT NULL DEFAULT 'virtual',
      metadata TEXT,
      isActive INTEGER NOT NULL DEFAULT 1,
      isBlindBox INTEGER NOT NULL DEFAULT 0,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL
    );
    CREATE TABLE IF NOT EXISTS PointsRedemption (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      productId TEXT NOT NULL,
      productName TEXT NOT NULL,
      pointsCost INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      shippingInfo TEXT,
      trackingNumber TEXT,
      adminNote TEXT,
      variantName TEXT,
      createdAt DATETIME NOT NULL,
      updatedAt DATETIME NOT NULL
    );
    CREATE TABLE IF NOT EXISTS Notification (
      id TEXT PRIMARY KEY,
      userId TEXT,
      email TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      isRead INTEGER NOT NULL DEFAULT 0,
      linkUrl TEXT,
      metadata TEXT,
      scope TEXT NOT NULL DEFAULT 'personal',
      requiresAck INTEGER NOT NULL DEFAULT 0,
      createdByUserId TEXT,
      deletedAt DATETIME,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS NotificationReceipt (
      id TEXT PRIMARY KEY,
      notificationId TEXT NOT NULL,
      userId TEXT NOT NULL,
      isRead INTEGER NOT NULL DEFAULT 0,
      acknowledgedAt DATETIME,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL,
      UNIQUE(notificationId, userId)
    );
    CREATE TABLE IF NOT EXISTS Address (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      address TEXT NOT NULL,
      institution TEXT,
      label TEXT,
      isDefault INTEGER NOT NULL DEFAULT 0,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL
    );
    CREATE TABLE IF NOT EXISTS Inquiry (
      id TEXT PRIMARY KEY,
      userId TEXT,
      organization_id TEXT,
      owner_scope TEXT NOT NULL DEFAULT 'personal',
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT NOT NULL,
      institution TEXT NOT NULL,
      department TEXT,
      address TEXT,
      notes TEXT,
      subtotal REAL NOT NULL DEFAULT 0,
      paymentMethod TEXT,
      leadTime TEXT,
      identity TEXT,
      advisorName TEXT,
      advisorPhone TEXT,
      status TEXT NOT NULL DEFAULT 'pending_quote',
      operationLogs TEXT NOT NULL DEFAULT '[]',
      ip TEXT,
      userAgent TEXT,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      archivedAt DATETIME
    );
    CREATE TABLE IF NOT EXISTS "Order" (
      id TEXT PRIMARY KEY,
      inquiryId TEXT,
      organization_id TEXT,
      owner_scope TEXT NOT NULL DEFAULT 'personal',
      addressId TEXT,
      email TEXT NOT NULL,
      customerId TEXT,
      subtotal REAL NOT NULL,
      adjustmentTotal REAL NOT NULL DEFAULT 0,
      total REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      paymentMethod TEXT,
      addressName TEXT,
      addressPhone TEXT,
      addressText TEXT,
      addressInstitution TEXT,
      shippingMethod TEXT NOT NULL DEFAULT 'logistics',
      logisticsCompany TEXT,
      logisticsNumber TEXT,
      selfPickupPoint TEXT,
      dedicatedContact TEXT,
      dedicatedPhone TEXT,
      operationLogs TEXT NOT NULL DEFAULT '[]',
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL,
      archivedAt DATETIME
      ,paidAt DATETIME
      ,quoteSent INTEGER NOT NULL DEFAULT 0,
      quoteSentAt DATETIME,
      legalAcceptedIds TEXT,
      legalAcceptedSnapshot TEXT,
      pointsPersonal INTEGER NOT NULL DEFAULT 0,
      pointsGroup INTEGER NOT NULL DEFAULT 0,
      pointsGroupId TEXT,
      pointsDiscount REAL NOT NULL DEFAULT 0,
      pointsApplied INTEGER NOT NULL DEFAULT 0,
      pointsAppliedAt DATETIME,
      pointsRefundedPersonal INTEGER NOT NULL DEFAULT 0,
      pointsRefundedGroup INTEGER NOT NULL DEFAULT 0,
      auto_close_at DATETIME
    );
    CREATE TABLE IF NOT EXISTS user_devices (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      name TEXT,
      browser TEXT,
      operating_system TEXT,
      ip TEXT,
      last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      revoked_at DATETIME
    );
    CREATE INDEX IF NOT EXISTS user_devices_user_fingerprint_idx ON user_devices(user_id, fingerprint);
    CREATE INDEX IF NOT EXISTS user_devices_user_revoked_idx ON user_devices(user_id, revoked_at);
    CREATE TABLE IF NOT EXISTS user_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      session_id TEXT NOT NULL UNIQUE,
      device_id TEXT,
      ip TEXT,
      user_agent TEXT,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_mfa_at DATETIME,
      expires_at DATETIME,
      revoked_at DATETIME
    );
    CREATE INDEX IF NOT EXISTS user_sessions_user_revoked_seen_idx ON user_sessions(user_id, revoked_at, last_seen_at);
    CREATE INDEX IF NOT EXISTS user_sessions_device_idx ON user_sessions(device_id);
    CREATE TABLE IF NOT EXISTS PaymentAttempt (
      id TEXT PRIMARY KEY,
      orderId TEXT NOT NULL,
      provider TEXT NOT NULL,
      outTradeNo TEXT NOT NULL UNIQUE,
      amount REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'created',
      tradeNo TEXT,
      notifiedAt DATETIME,
      paidAt DATETIME,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL,
      FOREIGN KEY (orderId) REFERENCES "Order"(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS Product (
      id TEXT PRIMARY KEY,
      catalogNumber TEXT NOT NULL,
      name TEXT NOT NULL,
      brand TEXT NOT NULL,
      price REAL NOT NULL,
      pricingMode TEXT NOT NULL DEFAULT 'fixed',
      originalPrice REAL,
      category TEXT,
      subcategory TEXT,
      type TEXT,
      spec TEXT,
      salesUnit TEXT,
      target TEXT,
      host TEXT,
      applications TEXT NOT NULL DEFAULT '[]',
      reactivity TEXT NOT NULL DEFAULT '[]',
      description TEXT,
      specificity TEXT,
      productUsage TEXT,
      speciesReactivity TEXT,
      speciesPredicted TEXT,
      inStock INTEGER NOT NULL DEFAULT 1,
      promotionalPrice REAL,
      promotion INTEGER NOT NULL DEFAULT 0,
      costPrice REAL,
      minimumSalePrice REAL,
      subBrand TEXT,
      imageUrl TEXT,
      casNumber TEXT,
      hazardous INTEGER NOT NULL DEFAULT 0,
      leadTime TEXT,
      storageTemp TEXT,
      storageBuffer TEXT,
      expiryDate TEXT,
      lotNumber TEXT,
      cloneNumber TEXT,
      purity TEXT,
      molecularWeight REAL,
      isoelectricPoint REAL,
      concentration TEXT,
      cofaUrl TEXT,
      sdsUrl TEXT,
      pmids TEXT NOT NULL DEFAULT '[]',
      stockQuantity INTEGER NOT NULL DEFAULT -1,
      brandRecordId TEXT,
      categoryRecordId TEXT,
      subcategoryRecordId TEXT,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL,
      UNIQUE(brand, catalogNumber)
    );
    CREATE TABLE IF NOT EXISTS ProductVariant (
      id TEXT PRIMARY KEY,
      productId TEXT NOT NULL,
      catalogNumber TEXT NOT NULL,
      spec TEXT NOT NULL,
      price REAL NOT NULL,
      originalPrice REAL,
      promotionalPrice REAL,
      costPrice REAL,
      minimumSalePrice REAL,
      packageType TEXT,
      salesUnit TEXT,
      baseQuantity INTEGER NOT NULL DEFAULT 1,
      source TEXT
    );
    CREATE TABLE IF NOT EXISTS Brand (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      slug TEXT UNIQUE,
      description TEXT,
      websiteUrl TEXT,
      logoUrl TEXT,
      isActive INTEGER NOT NULL DEFAULT 1,
      sortOrder INTEGER NOT NULL DEFAULT 0,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ProductCategory (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT,
      parentId TEXT,
      description TEXT,
      isActive INTEGER NOT NULL DEFAULT 1,
      sortOrder INTEGER NOT NULL DEFAULT 0,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL,
      UNIQUE(parentId, name)
    );
    CREATE TABLE IF NOT EXISTS ProductAttribute (
      id TEXT PRIMARY KEY,
      productId TEXT NOT NULL,
      key TEXT NOT NULL,
      label TEXT NOT NULL,
      value TEXT NOT NULL,
      normalizedValue TEXT,
      unit TEXT,
      source TEXT,
      sortOrder INTEGER NOT NULL DEFAULT 0,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL,
      UNIQUE(productId, key, value)
    );
    CREATE TABLE IF NOT EXISTS ProductPrice (
      id TEXT PRIMARY KEY,
      productId TEXT NOT NULL,
      variantId TEXT,
      kind TEXT NOT NULL,
      amount REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT 'CNY',
      startsAt DATETIME,
      endsAt DATETIME,
      isActive INTEGER NOT NULL DEFAULT 1,
      source TEXT,
      createdBy TEXT,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS ProductPriceBreak (
      id TEXT PRIMARY KEY,
      productId TEXT NOT NULL,
      variantId TEXT,
      kind TEXT NOT NULL,
      label TEXT NOT NULL,
      salesUnit TEXT,
      baseQuantity INTEGER NOT NULL DEFAULT 1,
      listAmount REAL,
      publicAmount REAL,
      costAmount REAL,
      currency TEXT NOT NULL DEFAULT 'CNY',
      source TEXT,
      sourceSheet TEXT,
      sortOrder INTEGER NOT NULL DEFAULT 0,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL
    );
    CREATE TABLE IF NOT EXISTS Promotion (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, value REAL NOT NULL,
      ruleDefinition TEXT, ruleVersion INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'draft', startsAt DATETIME NOT NULL, endsAt DATETIME NOT NULL,
      priority INTEGER NOT NULL DEFAULT 0, exclusive INTEGER NOT NULL DEFAULT 1, createdBy TEXT,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updatedAt DATETIME NOT NULL
    );
    CREATE INDEX IF NOT EXISTS Promotion_status_startsAt_endsAt_idx ON Promotion(status, startsAt, endsAt);
    CREATE INDEX IF NOT EXISTS Promotion_priority_idx ON Promotion(priority);
    CREATE TABLE IF NOT EXISTS PromotionProduct (
      id TEXT PRIMARY KEY, promotionId TEXT NOT NULL, productId TEXT NOT NULL, variantId TEXT,
      groupKey TEXT NOT NULL DEFAULT 'main',
      UNIQUE(promotionId, productId, variantId),
      FOREIGN KEY (promotionId) REFERENCES Promotion(id) ON DELETE CASCADE ON UPDATE CASCADE,
      FOREIGN KEY (productId) REFERENCES Product(id) ON DELETE CASCADE ON UPDATE CASCADE,
      FOREIGN KEY (variantId) REFERENCES ProductVariant(id) ON DELETE CASCADE ON UPDATE CASCADE
    );
    CREATE INDEX IF NOT EXISTS PromotionProduct_productId_variantId_idx ON PromotionProduct(productId, variantId);
    CREATE TABLE IF NOT EXISTS ProductDocument (
      id TEXT PRIMARY KEY,
      productId TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      url TEXT NOT NULL,
      version TEXT,
      language TEXT DEFAULT 'zh-CN',
      source TEXT,
      sortOrder INTEGER NOT NULL DEFAULT 0,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL,
      UNIQUE(productId, type, url)
    );
    CREATE TABLE IF NOT EXISTS InquiryItem (
      id TEXT PRIMARY KEY,
      inquiryId TEXT NOT NULL,
      position INTEGER NOT NULL,
      productId TEXT,
      catalogNumber TEXT,
      name TEXT NOT NULL,
      unitPrice REAL,
      clientPrice REAL,
      quantity INTEGER NOT NULL DEFAULT 1,
      lineTotal REAL,
      leadTime TEXT,
      available INTEGER,
      ordered INTEGER NOT NULL DEFAULT 0,
      pricingSource TEXT,
      metadata TEXT,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL,
      UNIQUE(inquiryId, position),
      FOREIGN KEY(inquiryId) REFERENCES Inquiry(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS Quote (
      id TEXT PRIMARY KEY, inquiryId TEXT NOT NULL, version INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft', subtotal REAL NOT NULL, currency TEXT NOT NULL DEFAULT 'CNY',
      validUntil DATETIME, sentAt DATETIME, acceptedAt DATETIME, createdBy TEXT,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updatedAt DATETIME NOT NULL,
      UNIQUE(inquiryId, version)
    );
    CREATE TABLE IF NOT EXISTS QuoteItem (
      id TEXT PRIMARY KEY, quoteId TEXT NOT NULL, inquiryItemId TEXT, position INTEGER NOT NULL,
      productId TEXT, catalogNumber TEXT, name TEXT NOT NULL, unitPrice REAL NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1, orderedQty INTEGER NOT NULL DEFAULT 0, lineTotal REAL NOT NULL,
      leadTime TEXT, available INTEGER NOT NULL DEFAULT 1, notes TEXT,
      pricingSnapshot TEXT,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updatedAt DATETIME NOT NULL,
      UNIQUE(quoteId, position)
    );
    CREATE TABLE IF NOT EXISTS QuoteConfirmation (
      id TEXT PRIMARY KEY, quoteId TEXT NOT NULL, userId TEXT, email TEXT NOT NULL,
      action TEXT NOT NULL, details TEXT, ip TEXT, userAgent TEXT,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS OrderItem (
      id TEXT PRIMARY KEY,
      orderId TEXT NOT NULL,
      position INTEGER NOT NULL,
      productId TEXT,
      catalogNumber TEXT,
      name TEXT NOT NULL,
      brand TEXT,
      unitPrice REAL NOT NULL,
      clientPrice REAL,
      quantity INTEGER NOT NULL DEFAULT 1,
      shippedQty INTEGER NOT NULL DEFAULT 0,
      leadTime TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      metadata TEXT,
      pricingSnapshot TEXT,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL,
      UNIQUE(orderId, position),
      FOREIGN KEY(orderId) REFERENCES "Order"(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS OrderStatusHistory (
      id TEXT PRIMARY KEY,
      orderId TEXT NOT NULL,
      fromStatus TEXT,
      toStatus TEXT NOT NULL,
      actorId TEXT,
      actorEmail TEXT,
      reason TEXT,
      metadata TEXT,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(orderId) REFERENCES "Order"(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS OrderAddressSnapshot (
      id TEXT PRIMARY KEY, orderId TEXT UNIQUE NOT NULL, sourceAddressId TEXT,
      name TEXT NOT NULL, phone TEXT NOT NULL, address TEXT NOT NULL, institution TEXT,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS OrderAdjustment (
      id TEXT PRIMARY KEY, orderId TEXT NOT NULL, type TEXT NOT NULL, label TEXT NOT NULL,
      amount REAL NOT NULL, reason TEXT, createdBy TEXT, createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS Shipment (
      id TEXT PRIMARY KEY, orderId TEXT NOT NULL, method TEXT NOT NULL DEFAULT 'logistics',
      status TEXT NOT NULL DEFAULT 'pending', carrier TEXT, trackingNumber TEXT, pickupPoint TEXT,
      contactName TEXT, contactPhone TEXT, note TEXT, shippedAt DATETIME, deliveredAt DATETIME,
      createdBy TEXT, createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updatedAt DATETIME NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ShipmentItem (
      id TEXT PRIMARY KEY, shipmentId TEXT NOT NULL, orderItemId TEXT NOT NULL, quantity INTEGER NOT NULL,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(shipmentId, orderItemId)
    );
    CREATE TABLE IF NOT EXISTS OrderEvent (
      id TEXT PRIMARY KEY, orderId TEXT NOT NULL, type TEXT NOT NULL, actorId TEXT, actorEmail TEXT,
      message TEXT, metadata TEXT, createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS InventoryAccount (
      id TEXT PRIMARY KEY, productId TEXT NOT NULL, variantId TEXT,
      actualQuantity INTEGER NOT NULL DEFAULT -1, availableQuantity INTEGER NOT NULL DEFAULT -1,
      reservedQuantity INTEGER NOT NULL DEFAULT 0, shippedQuantity INTEGER NOT NULL DEFAULT 0,
      inboundQuantity INTEGER NOT NULL DEFAULT 0, createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL, UNIQUE(productId, variantId)
    );
    CREATE TABLE IF NOT EXISTS InventoryBatch (
      id TEXT PRIMARY KEY, inventoryAccountId TEXT NOT NULL, batchNumber TEXT NOT NULL,
      quantity INTEGER NOT NULL, reservedQuantity INTEGER NOT NULL DEFAULT 0, expiryDate DATETIME,
      receivedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL, UNIQUE(inventoryAccountId, batchNumber)
    );
    CREATE TABLE IF NOT EXISTS InventoryReservation (
      id TEXT PRIMARY KEY, inventoryAccountId TEXT NOT NULL, orderId TEXT NOT NULL, orderItemId TEXT UNIQUE NOT NULL,
      quantity INTEGER NOT NULL, fulfilledQuantity INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'active',
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updatedAt DATETIME NOT NULL
    );
    CREATE TABLE IF NOT EXISTS InventoryTransaction (
      id TEXT PRIMARY KEY, inventoryAccountId TEXT NOT NULL, batchId TEXT, reservationId TEXT, orderId TEXT,
      type TEXT NOT NULL, quantity INTEGER NOT NULL, reason TEXT NOT NULL, actorId TEXT,
      actualBefore INTEGER NOT NULL, actualAfter INTEGER NOT NULL, availableBefore INTEGER NOT NULL,
      availableAfter INTEGER NOT NULL, reservedBefore INTEGER NOT NULL, reservedAfter INTEGER NOT NULL,
      inboundBefore INTEGER NOT NULL, inboundAfter INTEGER NOT NULL, shippedBefore INTEGER NOT NULL,
      shippedAfter INTEGER NOT NULL, createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS InventoryReservationBatch (
      id TEXT PRIMARY KEY, reservationId TEXT NOT NULL, batchId TEXT NOT NULL,
      quantity INTEGER NOT NULL, fulfilledQuantity INTEGER NOT NULL DEFAULT 0,
      UNIQUE(reservationId, batchId)
    );
    CREATE TABLE IF NOT EXISTS CreditAccount (
      id TEXT PRIMARY KEY, userId TEXT UNIQUE NOT NULL, baseLimit REAL NOT NULL, overrideLimit REAL,
      temporaryLimit REAL NOT NULL DEFAULT 0, temporaryUntil DATETIME, usedAmount REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active', paymentTermDays INTEGER NOT NULL DEFAULT 30,
      manuallyUnlockedAt DATETIME, createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updatedAt DATETIME NOT NULL
    );
    CREATE TABLE IF NOT EXISTS CreditTransaction (
      id TEXT PRIMARY KEY, userId TEXT NOT NULL, orderId TEXT, type TEXT NOT NULL, amount REAL NOT NULL,
      balanceAfter REAL NOT NULL, reason TEXT, actorId TEXT, createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS AccountReceivable (
      id TEXT PRIMARY KEY, orderId TEXT UNIQUE NOT NULL, userId TEXT NOT NULL, amount REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'open', confirmedAt DATETIME NOT NULL, termStartedAt DATETIME, dueAt DATETIME,
      paymentTermDaysSnapshot INTEGER NOT NULL DEFAULT 30, paidAt DATETIME,
      lastReminderAt DATETIME, reminderCount INTEGER NOT NULL DEFAULT 0,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updatedAt DATETIME NOT NULL
    );
    CREATE TABLE IF NOT EXISTS UserTierHistory (
      id TEXT PRIMARY KEY, userId TEXT NOT NULL, fromTier TEXT, toTier TEXT NOT NULL, rollingSpend REAL NOT NULL,
      calculationFrom DATETIME NOT NULL, calculationTo DATETIME NOT NULL, reason TEXT NOT NULL,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS SystemSettings (
      id INTEGER PRIMARY KEY,
      pointsPerYuan REAL NOT NULL DEFAULT 1.0,
      pointsPerYuanActive INTEGER NOT NULL DEFAULT 1,
      organizationCreationEnabled INTEGER NOT NULL DEFAULT 0,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL
    );
    CREATE TABLE IF NOT EXISTS organization_creation_grants (
      id TEXT PRIMARY KEY,
      user_id TEXT UNIQUE NOT NULL,
      granted_by_user_id TEXT,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS WechatMiniLoginChallenge (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'pending',
      providerAccountId TEXT,
      userId TEXT,
      loginToken TEXT UNIQUE,
      oauthName TEXT,
      oauthImage TEXT,
      oauthSex INTEGER,
      expiresAt DATETIME NOT NULL,
      completedAt DATETIME,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL
    );
    CREATE TABLE IF NOT EXISTS _rate_limits (
      ip TEXT NOT NULL,
      window_start INTEGER NOT NULL,
      request_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (ip, window_start)
    );
  `);
  return _db;
}

export function closeTestDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
  // 不删 file —— 下次 getTestDb() 会重新打开同一 file + 用 IF NOT EXISTS 幂等创建 schema
  // file 由 vitest env 指定的 /tmp/... 路径，进程退出后 OS 自动清理
}

export function seedUserWithPassword(db: Database.Database, user: {
  id: string;
  email: string;
  passwordHash: string;
  name?: string;
  role?: string;
}) {
  db.prepare(`
    INSERT INTO User (id, name, email, password, role, points, tier, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, 0, 'tier-2', datetime('now'), datetime('now'))
  `).run(
    user.id,
    user.name ?? 'Test User',
    user.email,
    user.passwordHash,
    user.role ?? 'customer',
  );
}

export function seedUser(db: Database.Database, user: {
  id: string;
  email: string;
  name?: string;
  role?: string;
  points?: number;
  tier?: string;
  phone?: string | null;
  phoneVerifiedAt?: string | null;
  institution?: string | null;
  department?: string | null;
  institutionType?: string | null;
  institutionName?: string | null;
  institutionUnit?: string | null;
  institutionFacility?: string | null;
  school?: string | null;
  college?: string | null;
  major?: string | null;
  building?: string | null;
  piLab?: string | null;
  affiliatedLab?: string | null;
}) {
  db.prepare(`
    INSERT INTO User (
      id, name, email, role, points, tier, phone, phoneVerifiedAt,
      institution, department, institutionType, institutionName, institutionUnit, institutionFacility,
      school, college, major, building, piLab, affiliatedLab,
      createdAt, updatedAt
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `).run(
    user.id,
    user.name ?? 'Test User',
    user.email,
    user.role ?? 'customer',
    user.points ?? 0,
    user.tier ?? 'standard',
    user.phone ?? null,
    user.phoneVerifiedAt ?? null,
    user.institution ?? null,
    user.department ?? null,
    user.institutionType ?? null,
    user.institutionName ?? null,
    user.institutionUnit ?? null,
    user.institutionFacility ?? null,
    user.school ?? null,
    user.college ?? null,
    user.major ?? null,
    user.building ?? null,
    user.piLab ?? null,
    user.affiliatedLab ?? null,
  );
}

export function seedAdmin(db: Database.Database, id = 'admin_test_id', email = 'admin@test.com') {
  seedUser(db, { id, email, name: 'Admin', role: 'admin' });
  db.prepare(`INSERT OR IGNORE INTO AdminRole (id, key, name, description, updatedAt) VALUES ('role_super_admin', 'super_admin', '超级管理员', '全部管理能力', datetime('now'))`).run();
  const permissionKeys = [
    'admin.access', 'products.read', 'products.write', 'pricing.read', 'pricing.write', 'inventory.read', 'inventory.write',
    'inquiries.read', 'inquiries.write', 'orders.read', 'orders.write', 'customers.read', 'customers.write',
    'content.read', 'content.write', 'points.read', 'points.write', 'finance.read', 'finance.write', 'roles.manage', 'audit.read',
    'tasks.read', 'tasks.manage',
  ];
  const insertPermission = db.prepare('INSERT OR IGNORE INTO AdminPermission (id, key, resource, action, name) VALUES (?, ?, ?, ?, ?)');
  const insertRolePermission = db.prepare('INSERT OR IGNORE INTO AdminRolePermission (roleId, permissionId) VALUES (?, ?)');
  for (const key of permissionKeys) {
    const permissionId = `perm_${key.replace('.', '_')}`;
    const [resource, action] = key.split('.');
    insertPermission.run(permissionId, key, resource, action, key);
    insertRolePermission.run('role_super_admin', permissionId);
  }
  db.prepare('INSERT OR IGNORE INTO AdminUserRole (userId, roleId) VALUES (?, ?)').run(id, 'role_super_admin');
}

export function clearAllTables(db: Database.Database) {
  // 清表顺序：先子表后父表（外键依赖）
  db.exec(`
    DELETE FROM WechatMiniLoginChallenge;
    DELETE FROM AuditLog;
    DELETE FROM BackgroundTask;
    DELETE FROM TransientEntry;
    DELETE FROM AdminUserRole;
    DELETE FROM AdminMfaSetting;
    DELETE FROM AdminRolePermission;
    DELETE FROM AdminPermission;
    DELETE FROM AdminRole;
    DELETE FROM Account;
    DELETE FROM VerificationToken;
    DELETE FROM PointsRedemption;
    DELETE FROM PointsLog;
    DELETE FROM ShipmentItem;
    DELETE FROM Shipment;
    DELETE FROM InventoryTransaction;
    DELETE FROM InventoryReservationBatch;
    DELETE FROM InventoryReservation;
    DELETE FROM InventoryBatch;
    DELETE FROM InventoryAccount;
    DELETE FROM OrderEvent;
    DELETE FROM OrderAdjustment;
    DELETE FROM OrderAddressSnapshot;
    DELETE FROM OrderStatusHistory;
    DELETE FROM OrderItem;
    DELETE FROM PaymentAttempt;
    DELETE FROM CreditTransaction;
    DELETE FROM AccountReceivable;
    DELETE FROM UserTierHistory;
    DELETE FROM CreditAccount;
    DELETE FROM QuoteConfirmation;
    DELETE FROM QuoteItem;
    DELETE FROM Quote;
    DELETE FROM InquiryItem;
    DELETE FROM ProductDocument;
    DELETE FROM PromotionProduct;
    DELETE FROM Promotion;
    DELETE FROM ProductPrice;
    DELETE FROM ProductPriceBreak;
    DELETE FROM ProductAttribute;
    DELETE FROM ProductVariant;
    DELETE FROM Product;
    DELETE FROM ProductCategory;
    DELETE FROM Brand;
    DELETE FROM "Order";
    DELETE FROM Inquiry;
    DELETE FROM Address;
    DELETE FROM NotificationReceipt;
    DELETE FROM Notification;
    DELETE FROM user_sessions;
    DELETE FROM user_devices;
    DELETE FROM DiscountTemplate;
    DELETE FROM PointsProduct;
    DELETE FROM User;
    DELETE FROM _rate_limits;
  `);
}
