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

export function buildXmlFeed(variants) {
  const dash = String.fromCharCode(45);
  const encoding = "UTF" + dash + "8";
  const xmlHeader = `<?xml version="1.0" encoding="${encoding}"?>`;
  const formattedDate = formatFeedDate();
  
  let xml = `${xmlHeader}\n`;
  xml += `<yml_catalog date="${formattedDate}">\n`;
  xml += "  <shop>\n";
  xml += "    <offers>\n";
  
  for (const variant of variants) {
    const variantId = variant.id.split("/").pop();
    const productTitle = variant.product?.title || "";
    const variantTitle = variant.title || "";
    
    let name = productTitle;
    if (variantTitle !== "Default Title" && variantTitle !== "") {
      name = `${productTitle} ${dash} ${variantTitle}`;
    }
    
    const price = variant.price || "0.00";
    const picture = variant.image?.url || variant.product?.featuredImage?.url || "";
    const description = variant.product?.description || variant.product?.descriptionHtml || "";
    const qty = variant.inventoryQuantity ?? 0;
    
    const consistMetafield = variant.product?.metafield?.value;
    const consistName = consistMetafield || "Flowers";
    
    xml += `      <offer id="${escapeXml(variantId)}">\n`;
    xml += `        <name>${escapeXml(name)}</name>\n`;
    xml += `        <price>${escapeXml(price)}</price>\n`;
    xml += `        <picture>${escapeXml(picture)}</picture>\n`;
    xml += `        <description>${escapeXml(description)}</description>\n`;
    xml += `        <qty>${parseInt(qty, 10)}</qty>\n`;
    xml += `        <consist name="${escapeXml(consistName)}"/>\n`;
    xml += "      </offer>\n";
  }
  
  xml += "    </offers>\n";
  xml += "  </shop>\n";
  xml += "</yml_catalog>\n";
  
  return xml;
}
