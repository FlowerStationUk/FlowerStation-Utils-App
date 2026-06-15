import { useState, useEffect } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { promises as fs } from "fs";
import path from "path";
import { run } from "../feedWorker.js";

export const loader = async () => {
  const filePath = path.join(process.cwd(), "public", "feeds", "flowwow.xml");
  let lastUpdated = null;
  try {
    const stats = await fs.stat(filePath);
    const date = stats.mtime;
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    const seconds = String(date.getSeconds()).padStart(2, "0");
    const dash = String.fromCharCode(45);
    lastUpdated = `${year}${dash}${month}${dash}${day} ${hours}:${minutes}:${seconds}`;
  } catch (error) {
    lastUpdated = "Not generated yet";
  }
  
  const appUrl = process.env.SHOPIFY_APP_URL || "";
  const feedUrl = `${appUrl}/api/feeds/flowwow`;
  
  return { feedUrl, lastUpdated };
};

export const action = async () => {
  try {
    run().catch((err) => {
      console.error(err);
    });
    return { success: true };
  } catch (err) {
    return { error: err.message };
  }
};

export default function ProductFeed() {
  const { feedUrl, lastUpdated } = useLoaderData();
  const fetcher = useFetcher();
  const [copied, setCopied] = useState(false);
  const [generating, setGenerating] = useState(false);
  
  const handleCopy = () => {
    navigator.clipboard.writeText(feedUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  
  const handleGenerate = () => {
    setGenerating(true);
    fetcher.submit({ action: "generate" }, { method: "post" });
  };
  
  useEffect(() => {
    if (fetcher.data) {
      setGenerating(false);
    }
  }, [fetcher.data]);
  
  return (
    <s-page heading="Product Feed Export">
      <s-section heading="Flowwow and Udora XML Catalog">
        <s-paragraph>
          This feature automatically generates a product feed compliant with the Flowwow and Udora specifications. The feed is cached and runs automatically every 4 hours.
        </s-paragraph>
        
        <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued" style={{ marginTop: "16px" }}>
          <s-stack direction="block" gap="tight">
            <s-text size="bold">XML Feed Public URL</s-text>
            <s-stack direction="inline" gap="base" align="center" style={{ marginTop: "8px" }}>
              <s-text style={{ fontFamily: "monospace", wordBreak: "break-all" }}>{feedUrl}</s-text>
              <s-button size="small" onClick={handleCopy}>
                {copied ? "Copied" : "Copy Link"}
              </s-button>
            </s-stack>
          </s-stack>
        </s-box>
        
        <s-stack direction="block" gap="tight" style={{ marginTop: "24px" }}>
          <s-text>Last generation: {lastUpdated}</s-text>
          <s-paragraph color="subdued" size="small">
            You can trigger a manual generation below. This processes in the background to avoid timeouts.
          </s-paragraph>
          <s-stack direction="inline" gap="base" style={{ marginTop: "12px" }}>
            <s-button variant="primary" onClick={handleGenerate} disabled={generating}>
              {generating ? "Starting Sync..." : "Sync Feed Now"}
            </s-button>
          </s-stack>
        </s-stack>
      </s-section>
    </s-page>
  );
}
