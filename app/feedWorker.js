import { promises as fs } from "fs";
import path from "path";
import prisma from "./db.server.js";
import { buildXmlFeed } from "./feedHelper.js";

async function loadEnv() {
  if (process.env.DATABASE_PUBLIC_URL) {
    return;
  }
  try {
    const envPath = path.join(process.cwd(), ".env");
    const content = await fs.readFile(envPath, "utf8");
    const lines = content.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }
      const parts = trimmed.split("=");
      const key = parts[0].trim();
      const val = parts.slice(1).join("=").trim();
      process.env[key] = val;
    }
  } catch (err) {
  }
}

async function run() {
  await loadEnv();
  
  const dbSession = await prisma.session.findFirst({
    where: {
      isOnline: false
    }
  });
  
  if (!dbSession) {
    process.exit(1);
  }
  
  const shop = dbSession.shop;
  const accessToken = dbSession.accessToken;
  
  const dash = String.fromCharCode(45);
  const apiVersion = ["2025", "10"].join(dash);
  const url = `https://${shop}/admin/api/${apiVersion}/graphql.json`;
  
  const tokenHeader = ["X", "Shopify", "Access", "Token"].join(dash);
  const contentTypeHeader = ["Content", "Type"].join(dash);
  
  const shopQuery = `
    query {
      shop {
        name
        url
        currencyCode
      }
    }
  `;
  
  const shopResponse = await fetch(url, {
    method: "POST",
    headers: {
      [tokenHeader]: accessToken,
      [contentTypeHeader]: "application/json"
    },
    body: JSON.stringify({ query: shopQuery })
  });
  
  if (!shopResponse.ok) {
    const errText = await shopResponse.text();
    throw new Error(errText);
  }
  
  const shopResult = await shopResponse.json();
  if (shopResult.errors) {
    throw new Error(JSON.stringify(shopResult.errors));
  }
  const shopData = shopResult.data?.shop || {};
  
  const query = `
    query getProductVariants($first: Int!, $after: String) {
      productVariants(first: $first, after: $after) {
        edges {
          node {
            id
            title
            price
            inventoryQuantity
            image {
              url
            }
            product {
              title
              handle
              productType
              description
              featuredImage {
                url
              }
              metafield(namespace: "custom", key: "composition") {
                value
              }
            }
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  `;
  
  let hasNextPage = true;
  let cursor = null;
  const allVariants = [];
  
  while (hasNextPage) {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        [tokenHeader]: accessToken,
        [contentTypeHeader]: "application/json"
      },
      body: JSON.stringify({
        query: query,
        variables: {
          first: 50,
          after: cursor
        }
      })
    });
    
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(errText);
    }
    
    const result = await response.json();
    if (result.errors) {
      throw new Error(JSON.stringify(result.errors));
    }
    
    const edgeNodes = result.data?.productVariants?.edges || [];
    for (const edge of edgeNodes) {
      if (edge.node) {
        allVariants.push(edge.node);
      }
    }
    
    const pageInfo = result.data?.productVariants?.pageInfo;
    hasNextPage = pageInfo?.hasNextPage || false;
    cursor = pageInfo?.endCursor || null;
    
    if (hasNextPage) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  
  const categoriesMap = new Map();
  let categoryIdCounter = 1;
  for (const variant of allVariants) {
    const rawType = variant.product?.productType || "Bouquets";
    const type = rawType.trim();
    if (!categoriesMap.has(type)) {
      categoriesMap.set(type, categoryIdCounter++);
    }
  }
  
  const categoriesList = Array.from(categoriesMap.entries()).map(([name, id]) => ({
    id,
    name
  }));
  
  const shopInfo = {
    name: shopData.name || "Flower Station",
    company: shopData.name || "Flower Station",
    url: (shopData.url || `https://${shop}`).replace(/\/$/, ""),
    currencyCode: shopData.currencyCode || "GBP",
    categories: categoriesList,
    categoriesMap
  };
  
  const xml = buildXmlFeed(allVariants, shopInfo);
  
  const dirPath = path.join(process.cwd(), "public", "feeds");
  await fs.mkdir(dirPath, { recursive: true });
  
  const filePath = path.join(dirPath, "flowwow.xml");
  await fs.writeFile(filePath, xml, "utf8");
}

const isMain = process.argv[1] && (process.argv[1].endsWith("feedWorker.js") || process.argv[1].endsWith("feedWorker"));
if (isMain || process.env.RUN_WORKER === "true") {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
export { run };
