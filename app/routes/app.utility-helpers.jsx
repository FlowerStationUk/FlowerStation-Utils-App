import { useState } from "react";
import { useFetcher } from "react-router";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return null;
};

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const action = formData.get("action");

  if (action === "fetch_discounts") {
    try {
      const response = await admin.graphql(
        `#graphql
          query getDiscounts($first: Int!) {
            discountNodes(first: $first) {
              edges {
                node {
                  id
                  discount {
                    ... on DiscountCodeBasic {
                      title
                      status
                      summary
                      codes(first: 1) {
                        edges {
                          node {
                            code
                          }
                        }
                      }
                      startsAt
                      endsAt
                      usageLimit
                      asyncUsageCount
                      appliesOncePerCustomer
                    }
                  }
                }
              }
            }
          }`,
        {
          variables: { first: 50 }
        }
      );

      const result = await response.json();
      return {
        success: true,
        discounts: result.data.discountNodes.edges.map(edge => edge.node)
      };
    } catch (error) {
      return { error: error.message };
    }
  }

  return { error: "Invalid action" };
};

export default function UtilityHelpers() {
  const fetcher = useFetcher();
  const { discounts } = fetcher.data || { discounts: [] };

  const handleFetchDiscounts = () => {
    fetcher.submit(
      { action: "fetch_discounts" },
      { method: "POST" }
    );
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
  };

  return (
    <s-page heading="Utility Helpers">

      <s-section heading="Get Discount IDs">
        <s-paragraph>
          Use this tool to easily find and copy Shopify discount IDs that you can use
          as master discounts in the Bulk Discount feature.
        </s-paragraph>

        <s-button
          onClick={handleFetchDiscounts}
          loading={fetcher.state === "submitting"}
          variant="primary"
        >
          Fetch All Discounts
        </s-button>

        {fetcher.data?.error && (
          <s-banner status="critical" style={{ marginTop: "16px" }}>
            {fetcher.data.error}
          </s-banner>
        )}

        {discounts.length > 0 && (
          <s-section heading={`Found ${discounts.length} discount(s)`}>
            <s-stack direction="block" gap="base">
              {discounts.map((discountNode) => (
                <s-card key={discountNode.id}>
                  <s-stack direction="block" gap="base">
                    <s-stack direction="inline" gap="base">
                      <s-heading size="small">
                        {discountNode.discount.title}
                      </s-heading>
                      <s-badge variant={
                        discountNode.discount.status === 'ACTIVE' ? 'success' : 'attention'
                      }>
                        {discountNode.discount.status}
                      </s-badge>
                    </s-stack>

                    <s-text size="small" color="subdued">
                      {discountNode.discount.summary}
                    </s-text>

                    <s-stack direction="inline" gap="base">
                      <s-text size="small">
                        <strong>Code:</strong> {discountNode.discount.codes?.edges[0]?.node.code || 'No code'}
                      </s-text>
                      <s-text size="small">
                        <strong>Usage:</strong> {discountNode.discount.asyncUsageCount || 0} / {discountNode.discount.usageLimit || '∞'}
                      </s-text>
                      <s-text size="small">
                        <strong>One use per customer:</strong> {discountNode.discount.appliesOncePerCustomer ? 'Yes' : 'No'}
                      </s-text>
                    </s-stack>

                    <s-box
                      padding="base"
                      borderWidth="base"
                      borderRadius="base"
                      background="subdued"
                    >
                      <s-stack direction="inline" gap="base">
                        <s-text size="small" style={{ fontFamily: "monospace", flex: 1 }}>
                          {discountNode.id}
                        </s-text>
                        <s-button
                          size="small"
                          onClick={() => copyToClipboard(discountNode.id)}
                        >
                          Copy ID
                        </s-button>
                      </s-stack>
                    </s-box>
                  </s-stack>
                </s-card>
              ))}
            </s-stack>
          </s-section>
        )}
      </s-section>

      <s-section heading="CSV Format Guide">
        <s-paragraph>
          When creating your CSV file for bulk discount codes, use one of these formats:
        </s-paragraph>

        <s-section heading="Option 1: One code per line">
          <s-box
            padding="base"
            borderWidth="base"
            borderRadius="base"
            background="subdued"
          >
            <pre style={{ margin: 0, fontSize: "12px" }}>
{`SAVE10WINTER
HOLIDAY20
BLACKFRIDAY25
CYBER30`}
            </pre>
          </s-box>
        </s-section>

        <s-section heading="Option 2: Comma-separated">
          <s-box
            padding="base"
            borderWidth="base"
            borderRadius="base"
            background="subdued"
          >
            <pre style={{ margin: 0, fontSize: "12px" }}>
SAVE10WINTER,HOLIDAY20,BLACKFRIDAY25,CYBER30
            </pre>
          </s-box>
        </s-section>

        <s-section heading="Option 3: Mixed format">
          <s-box
            padding="base"
            borderWidth="base"
            borderRadius="base"
            background="subdued"
          >
            <pre style={{ margin: 0, fontSize: "12px" }}>
{`SAVE10WINTER,HOLIDAY20
BLACKFRIDAY25
CYBER30,NEWYEAR15`}
            </pre>
          </s-box>
        </s-section>
      </s-section>
    </s-page>
  );
}
