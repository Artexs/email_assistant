# Supabase Adapter Usage Examples

This document provides comprehensive examples of using the Supabase adapter.

## Setup

```typescript
import { IntegrationFactory } from "./factory";

const dbProvider = IntegrationFactory.createDatabaseProvider("SUPABASE", {
  url: process.env.SUPABASE_URL!,
  key: process.env.SUPABASE_KEY!,
});
```

## Read Operations

### Select All Records

```typescript
// Get all users
const users = await dbProvider.select("users");

// Get users with limit
const recentUsers = await dbProvider.select("users", {
  limit: 10,
});

// Get users with ordering
const sortedUsers = await dbProvider.select("users", {
  orderBy: { column: "created_at", ascending: false },
  limit: 5,
});
```

### Select with Filters

```typescript
// Get active mailboxes
const activeMailboxes = await dbProvider.select("mailboxes", {
  filters: [{ column: "is_active", operator: "eq", value: true }],
});

// Get contacts with trust score greater than 50
const trustedContacts = await dbProvider.select("contacts", {
  filters: [{ column: "trust_score", operator: "gt", value: 50 }],
});

// Get users created after a specific date
const newUsers = await dbProvider.select("users", {
  filters: [{ column: "created_at", operator: "gte", value: "2024-01-01" }],
});

// Multiple filters (AND condition)
const filteredContacts = await dbProvider.select("contacts", {
  filters: [
    { column: "trust_score", operator: "gte", value: 70 },
    { column: "category_id", operator: "is", value: null },
  ],
  limit: 20,
});

// Search with LIKE/ILIKE
const searchResults = await dbProvider.select("contacts", {
  filters: [{ column: "email", operator: "ilike", value: "%@example.com%" }],
});

// IN operator
const specificUsers = await dbProvider.select("users", {
  filters: [{ column: "id", operator: "in", value: ["uuid1", "uuid2", "uuid3"] }],
});
```

### Select Specific Columns

```typescript
// Select only specific columns
const userEmails = await dbProvider.select("users", {
  select: "id, email, full_name",
});

// Select with related data (Supabase foreign key expansion)
const mailboxesWithUser = await dbProvider.select("mailboxes", {
  select: "*, users(email, full_name)",
});
```

### Select One Record

```typescript
// Get first matching record
const firstUser = await dbProvider.selectOne("users", {
  filters: [{ column: "email", operator: "eq", value: "user@example.com" }],
});

if (firstUser) {
  console.log("User found:", firstUser);
} else {
  console.log("User not found");
}
```

### Select by ID

```typescript
// Get record by primary key
const user = await dbProvider.selectById("users", "user-uuid-here");

if (user) {
  console.log("User:", user);
}
```

### Count Records

```typescript
// Count all users
const totalUsers = await dbProvider.count("users");

// Count with filters
const activeMailboxCount = await dbProvider.count("mailboxes", {
  filters: [{ column: "is_active", operator: "eq", value: true }],
});
```

## Write Operations

### Insert

```typescript
// Insert single record
const [newUser] = await dbProvider.insert("users", {
  id: "user-uuid",
  email: "newuser@example.com",
  full_name: "New User",
});

// Insert multiple records
const newContacts = await dbProvider.insert("contacts", [
  {
    mailbox_id: "mailbox-uuid",
    email: "contact1@example.com",
    display_name: "Contact 1",
    trust_score: 50,
  },
  {
    mailbox_id: "mailbox-uuid",
    email: "contact2@example.com",
    display_name: "Contact 2",
    trust_score: 75,
  },
]);
```

### Update

```typescript
// Update by ID
const updatedUser = await dbProvider.updateById("users", "user-uuid", {
  full_name: "Updated Name",
});

// Update with filters (updates all matching records)
const updatedContacts = await dbProvider.update(
  "contacts",
  { trust_score: 100 },
  {
    filters: [{ column: "email", operator: "ilike", value: "%@trusted-domain.com%" }],
  }
);

// Deactivate all mailboxes for a user
await dbProvider.update(
  "mailboxes",
  { is_active: false },
  {
    filters: [{ column: "user_id", operator: "eq", value: "user-uuid" }],
  }
);
```

### Upsert

```typescript
// Upsert single record (insert or update if exists)
const [contact] = await dbProvider.upsert(
  "contacts",
  {
    mailbox_id: "mailbox-uuid",
    email: "contact@example.com",
    display_name: "Contact Name",
    trust_score: 80,
  },
  { onConflict: "mailbox_id,email" } // Unique constraint columns
);

// Upsert multiple records
const delegates = await dbProvider.upsert(
  "delegates",
  [
    {
      mailbox_id: "mailbox-uuid",
      email: "delegate1@example.com",
      display_name: "Delegate 1",
      competence_tags: ["sales", "support"],
    },
    {
      mailbox_id: "mailbox-uuid",
      email: "delegate2@example.com",
      display_name: "Delegate 2",
      competence_tags: ["technical", "engineering"],
    },
  ],
  { onConflict: "mailbox_id,email" }
);
```

### Delete

```typescript
// Delete by ID
await dbProvider.deleteById("contacts", "contact-uuid");

// Delete with filters
await dbProvider.delete("contacts", {
  filters: [{ column: "trust_score", operator: "lt", value: 0 }],
});

// Delete inactive mailboxes
await dbProvider.delete("mailboxes", {
  filters: [{ column: "is_active", operator: "eq", value: false }],
});
```

## Advanced Examples

### Pagination

```typescript
const pageSize = 20;
const page = 2; // 0-indexed

const paginatedUsers = await dbProvider.select("users", {
  limit: pageSize,
  offset: page * pageSize,
  orderBy: { column: "created_at", ascending: false },
});
```

### Complex Queries with TypeScript Types

```typescript
interface User {
  id: string;
  email: string;
  full_name: string | null;
  created_at: string;
  updated_at: string;
}

interface Mailbox {
  id: string;
  user_id: string;
  email: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// Type-safe queries
const users = await dbProvider.select<User>("users", {
  limit: 10,
});

const activeMailboxes = await dbProvider.select<Mailbox>("mailboxes", {
  filters: [{ column: "is_active", operator: "eq", value: true }],
});

// Type-safe single record
const user = await dbProvider.selectById<User>("users", "user-uuid");
```

### Working with JSONB Columns

```typescript
// Insert with JSONB data
await dbProvider.insert("contacts", {
  mailbox_id: "mailbox-uuid",
  email: "contact@example.com",
  draft_audit: [
    {
      timestamp: new Date().toISOString(),
      action: "created",
      user_id: "user-uuid",
    },
  ],
});

// Update JSONB column
await dbProvider.updateById("delegates", "delegate-uuid", {
  draft_audit: [
    ...existingAudit,
    {
      timestamp: new Date().toISOString(),
      action: "updated",
      changes: { competence_tags: ["new", "tags"] },
    },
  ],
});
```

### Batch Operations

```typescript
// Insert multiple categories at once
const categories = await dbProvider.insert("categories", [
  {
    mailbox_id: "mailbox-uuid",
    name: "VIP Clients",
    base_style_prompt: "Professional and formal",
  },
  {
    mailbox_id: "mailbox-uuid",
    name: "Team Members",
    base_style_prompt: "Casual and friendly",
  },
  {
    mailbox_id: "mailbox-uuid",
    name: "Vendors",
    base_style_prompt: "Business casual",
  },
]);

console.log(`Created ${categories.length} categories`);
```

## Error Handling

```typescript
try {
  const user = await dbProvider.selectById("users", "invalid-uuid");
  if (!user) {
    console.log("User not found");
  }
} catch (error) {
  console.error("Database error:", error);
  // Handle error appropriately
}

// With proper error types
import { PostgrestError } from "@supabase/supabase-js";

try {
  await dbProvider.insert("users", {
    email: "duplicate@example.com",
  });
} catch (error) {
  if ((error as PostgrestError).code === "23505") {
    console.error("Duplicate key violation");
  } else {
    console.error("Unknown error:", error);
  }
}
```

## Best Practices

1. **Always use filters for updates and deletes** to avoid accidentally modifying all records
2. **Use upsert** when you're not sure if a record exists
3. **Leverage TypeScript types** for type safety
4. **Handle null returns** from `selectOne` and `selectById`
5. **Use pagination** for large datasets
6. **Apply RLS policies** in Supabase for security
7. **Use transactions** for complex multi-table operations (via raw Supabase client if needed)

## Environment Variables

Add these to your `.env` file:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your-anon-or-service-role-key
```

For development, use the anon key. For backend services, use the service role key (keep it secret!).
