export function escapeXml(value) {
  if (value === null || value === undefined) {
    return "";
  }
  const str = String(value);
  return str.replace(/[<>&'"]/g, (char) => {
    switch (char) {
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "&":
        return "&amp;";
      case "'":
        return "&apos;";
      case "\"":
        return "&quot;";
      default:
        return char;
    }
  });
}

export function formatFeedDate(dateObj) {
  const date = dateObj || new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const dash = String.fromCharCode(45);
  return `${year}${dash}${month}${dash}${day} ${hours}:${minutes}`;
}

export function parseComposition(metafieldValue, typeValue) {
  const items = [];
  
  if (metafieldValue) {
    const delimiter = metafieldValue.includes("|") ? "|" : ",";
    const parts = metafieldValue.split(delimiter);
    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed) {
        continue;
      }
      
      const prefixMatch = trimmed.match(/^(x)?\s*(\d+)\s*(x)?\s+(.*)$/i);
      if (prefixMatch) {
        const qty = parseInt(prefixMatch[2], 10);
        const name = prefixMatch[4].trim();
        if (name && qty > 0) {
          items.push({ name, qty });
          continue;
        }
      }
      
      const suffixMatch = trimmed.match(/^(.*)\s+x\s*(\d+)$/i) || trimmed.match(/^(.*)\s+(\d+)\s*x$/i);
      if (suffixMatch) {
        const name = suffixMatch[1].trim();
        const qty = parseInt(suffixMatch[2], 10);
        if (name && qty > 0) {
          items.push({ name, qty });
          continue;
        }
      }
      
      items.push({ name: trimmed, qty: 1 });
    }
  }
  
  if (items.length === 0 && typeValue) {
    try {
      const parsed = JSON.parse(typeValue);
      if (Array.isArray(parsed)) {
        for (const val of parsed) {
          const name = String(val).trim();
          if (name) {
            items.push({ name, qty: 1 });
          }
        }
      }
    } catch (err) {
      const valStr = String(typeValue).trim();
      if (valStr) {
        items.push({ name: valStr, qty: 1 });
      }
    }
  }
  
  if (items.length === 0) {
    return [{ name: "Flowers", qty: 1 }];
  }
  return items;
}

export function buildXmlFeed(variants, shopInfo) {
  const dash = String.fromCharCode(45);
  const encoding = "UTF" + dash + "8";
  const xmlHeader = `<?xml version="1.0" encoding="${encoding}"?>`;
  const formattedDate = formatFeedDate();
  
  let xml = `${xmlHeader}\n`;
  xml += `<yml_catalog date="${formattedDate}">\n`;
  xml += "  <shop>\n";
  xml += `    <name>${escapeXml(shopInfo.name)}</name>\n`;
  xml += `    <company>${escapeXml(shopInfo.company)}</company>\n`;
  xml += `    <url>${escapeXml(shopInfo.url)}</url>\n`;
  xml += "    <categories>\n";
  for (const cat of shopInfo.categories) {
    xml += `      <category id="${cat.id}">${escapeXml(cat.name)}</category>\n`;
  }
  xml += "    </categories>\n";
  xml += "  </shop>\n";
  
  xml += "  <offers>\n";
  for (const variant of variants) {
    const variantId = variant.id ? variant.id.split("/").pop() : "";
    const productTitle = variant.product?.title || "";
    const variantTitle = variant.title || "";
    
    let name = productTitle;
    if (variantTitle !== "Default Title" && variantTitle !== "") {
      name = `${productTitle} ${dash} ${variantTitle}`;
    }
    
    const price = variant.price || "0.00";
    const picture = variant.image?.url || variant.product?.featuredImage?.url || "";
    const description = variant.product?.description || variant.product?.descriptionHtml || "";
    
    const rawType = variant.product?.productType || "Bouquets";
    const categoryId = shopInfo.categoriesMap.get(rawType.trim()) || 1;
    
    const productHandle = variant.product?.handle || "";
    const productUrl = productHandle ? `${shopInfo.url}/products/${productHandle}` : "";
    
    if (!variantId || !productUrl || !name || !price || parseFloat(price) <= 0 || !picture) {
      continue;
    }
    
    let finalDesc = description.trim();
    if (!finalDesc) {
      finalDesc = name;
    }
    
    const consistMetafield = variant.product?.composition?.value;
    const typeMetafield = variant.product?.type?.value;
    const consistItems = parseComposition(consistMetafield, typeMetafield);
    
    xml += `      <offer id="${escapeXml(variantId)}" available="true">\n`;
    xml += `        <url>${escapeXml(productUrl)}</url>\n`;
    xml += `        <name>${escapeXml(name)}</name>\n`;
    xml += `        <categoryId>${categoryId}</categoryId>\n`;
    xml += `        <picture>${escapeXml(picture)}</picture>\n`;
    xml += `        <price>${escapeXml(price)}</price>\n`;
    xml += `        <currencyId>${escapeXml(shopInfo.currencyCode)}</currencyId>\n`;
    xml += `        <description>${escapeXml(finalDesc)}</description>\n`;
    xml += '        <param name="width, mm">350</param>\n';
    xml += '        <param name="height, mm">400</param>\n';
    
    const lowerType = rawType.toLowerCase();
    const isFlowersOrEdible = lowerType.includes("flower") || lowerType.includes("bouquet");
    const hasFlowersConsist = consistItems.some((item) => item.name.toLowerCase() === "flowers");
    const shouldOmitQty = isFlowersOrEdible || hasFlowersConsist;
    
    if (!shouldOmitQty) {
      const parsedQty = Math.max(0, parseInt(variant.inventoryQuantity ?? 0, 10));
      xml += `        <qty>${parsedQty}</qty>\n`;
    }
    
    for (const item of consistItems) {
      xml += `        <consist name="${escapeXml(item.name)}" unit="pcs">${item.qty}</consist>\n`;
    }
    xml += `      </offer>\n`;
  }
  
  xml += "  </offers>\n";
  xml += "</yml_catalog>\n";
  
  return xml;
}
