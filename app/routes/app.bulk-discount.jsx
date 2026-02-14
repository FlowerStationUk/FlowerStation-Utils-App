import { useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);

  // Get existing discount sets for this shop
  const discountSets = await db.discountSet.findMany({
    where: { shop: session.shop },
    include: {
      discounts: {
        orderBy: { createdAt: 'desc' }
      }
    },
    orderBy: { createdAt: 'desc' }
  });

  return { discountSets, shop: session.shop };
};

export const action = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const action = formData.get("action");

  try {
    if (action === "create_discounts") {
      const masterDiscountId = formData.get("masterDiscountId");
      const discountSetName = formData.get("discountSetName");
      const codes = JSON.parse(formData.get("codes"));

      // Convert simple ID to GraphQL format if needed
      let formattedMasterDiscountId = masterDiscountId;
      if (!masterDiscountId.startsWith('gid://')) {
        formattedMasterDiscountId = `gid://shopify/DiscountCodeNode/${masterDiscountId}`;
      }

      // First, fetch the master discount from Shopify
      const masterDiscountResponse = await admin.graphql(
        `#graphql
          query getDiscount($id: ID!) {
            discountNode(id: $id) {
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
                  minimumRequirement {
                    ... on DiscountMinimumSubtotal {
                      greaterThanOrEqualToSubtotal {
                        amount
                        currencyCode
                      }
                    }
                    ... on DiscountMinimumQuantity {
                      greaterThanOrEqualToQuantity
                    }
                  }
                  customerGets {
                    value {
                      ... on DiscountPercentage {
                        percentage
                      }
                      ... on DiscountAmount {
                        amount {
                          amount
                          currencyCode
                        }
                      }
                    }
                    items {
                      ... on AllDiscountItems {
                        allItems
                      }
                      ... on DiscountProducts {
                        products(first: 250) {
                          edges {
                            node {
                              id
                            }
                          }
                        }
                      }
                      ... on DiscountCollections {
                        collections(first: 250) {
                          edges {
                            node {
                              id
                            }
                          }
                        }
                      }
                    }
                  }
                  context {
                    ... on DiscountBuyerSelectionAll {
                      all
                    }
                    ... on DiscountCustomers {
                      customers {
                        id
                      }
                    }
                  }
                  usageLimit
                  appliesOncePerCustomer
                  startsAt
                  endsAt
                  asyncUsageCount
                  recurringCycleLimit
                }
              }
            }
          }`,
        {
          variables: { id: formattedMasterDiscountId }
        }
      );

      const masterDiscountData = await masterDiscountResponse.json();

      console.log('Master discount response:', JSON.stringify(masterDiscountData, null, 2));

      // Better error handling
      if (masterDiscountData.errors) {
        console.error("GraphQL Errors:", masterDiscountData.errors);
        return {
          error: `GraphQL Error: ${masterDiscountData.errors[0].message}. Using ID: ${formattedMasterDiscountId}`
        };
      }

      const masterDiscount = masterDiscountData.data.discountNode?.discount;

      if (!masterDiscount) {
        console.error('No master discount found:', masterDiscountData);
        return {
          error: `Master discount not found with ID: ${formattedMasterDiscountId}. Please check if the discount exists and the ID is correct.`
        };
      }

      console.log('Master discount data:', JSON.stringify(masterDiscount, null, 2));
      const discountSet = await db.discountSet.create({
        data: {
          name: discountSetName,
          shop: session.shop,
          masterDiscountId: formattedMasterDiscountId
        }
      });

      // Create discount records in database first
      const discountRecords = await Promise.all(
        codes.map(code =>
          db.discount.create({
            data: {
              shop: session.shop,
              code: code,
              masterDiscountId: formattedMasterDiscountId,
              discountSetId: discountSet.id,
              status: 'PENDING'
            }
          })
        )
      );

      // Helper function to build item selection from master discount
      const buildItemSelection = () => {
        if (masterDiscount.customerGets.items.allItems) {
          return { all: true };
        } else if (masterDiscount.customerGets.items.products) {
          const productIds = masterDiscount.customerGets.items.products.edges.map(edge => edge.node.id);
          return { products: { productsToAdd: productIds } };
        } else if (masterDiscount.customerGets.items.collections) {
          const collectionIds = masterDiscount.customerGets.items.collections.edges.map(edge => edge.node.id);
          return { collections: { add: collectionIds } };
        }
        return { all: true };
      };

      // Helper function to build customer context from master discount
      const buildCustomerContext = () => {
        if (masterDiscount.context.all) {
          return { all: true };
        } else if (masterDiscount.context.customers) {
          // Copy customer IDs - customers field is a direct array, not a connection
          return { customers: { add: masterDiscount.context.customers.map(c => c.id) } };
        }
        return { all: true }; // Default to all if no context specified
      };

      const itemSelection = buildItemSelection();
      const customerContext = buildCustomerContext();

      // Now create discounts in Shopify
      const createdDiscounts = [];
      for (const discountRecord of discountRecords) {
        try {
          // Create discount input replicating ALL properties from master discount
          // Only difference: unique code from CSV
          const discountInput = {
            code: discountRecord.code,
            title: masterDiscount.title,
            startsAt: masterDiscount.startsAt,
            endsAt: masterDiscount.endsAt,
            context: customerContext, // Copy exact customer targeting from master
            customerGets: {
              value: masterDiscount.customerGets.value.percentage
                ? { percentage: masterDiscount.customerGets.value.percentage }
                : {
                    discountAmount: {
                      amount: masterDiscount.customerGets.value.amount.amount,
                      appliesOnEachItem: false
                    }
                  },
              items: itemSelection
            },
            minimumRequirement: masterDiscount.minimumRequirement,
            usageLimit: masterDiscount.usageLimit, // Copy exact usage limit from master
            appliesOncePerCustomer: masterDiscount.appliesOncePerCustomer // Copy exact setting from master
          };

          console.log(`Creating discount for code ${discountRecord.code} with input:`, JSON.stringify(discountInput, null, 2));

          const createDiscountResponse = await admin.graphql(
            `#graphql
              mutation discountCodeBasicCreate($basicCodeDiscount: DiscountCodeBasicInput!) {
                discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
                  codeDiscountNode {
                    id
                    codeDiscount {
                      ... on DiscountCodeBasic {
                        title
                        codes(first: 1) {
                          edges {
                            node {
                              code
                            }
                          }
                        }
                      }
                    }
                  }
                  userErrors {
                    field
                    message
                  }
                }
              }`,
            {
              variables: {
                basicCodeDiscount: discountInput
              }
            }
          );

          const createResult = await createDiscountResponse.json();

          // Handle discount creation result
          const userErrors = createResult.data?.discountCodeBasicCreate?.userErrors;
          const codeDiscountNode = createResult.data?.discountCodeBasicCreate?.codeDiscountNode;

          if (userErrors?.length > 0) {
            const errorMsg = userErrors.map(e => `${e.field}: ${e.message}`).join(', ');
            console.error(`Failed: ${discountRecord.code} - ${errorMsg}`);
            await db.discount.update({
              where: { id: discountRecord.id },
              data: { status: 'FAILED', errorMessage: errorMsg }
            });
          } else if (codeDiscountNode) {
            await db.discount.update({
              where: { id: discountRecord.id },
              data: { status: 'CREATED', shopifyId: codeDiscountNode.id }
            });
            createdDiscounts.push({ code: discountRecord.code, shopifyId: codeDiscountNode.id });
          } else {
            const errorMsg = 'Unexpected API response structure';
            console.error(`${errorMsg} for ${discountRecord.code}`);
            await db.discount.update({
              where: { id: discountRecord.id },
              data: { status: 'FAILED', errorMessage: errorMsg }
            });
          }
        } catch (error) {
          console.error(`Error creating ${discountRecord.code}:`, error.message);
          await db.discount.update({
            where: { id: discountRecord.id },
            data: { status: 'FAILED', errorMessage: error.message || 'Unknown error' }
          });
        }
      }

      return {
        success: true,
        message: `Created ${createdDiscounts.length} out of ${codes.length} discounts successfully`,
        createdDiscounts
      };
    }

    if (action === "delete_discount_set") {
      const discountSetId = formData.get("discountSetId");

      // Get all discounts in the set
      const discounts = await db.discount.findMany({
        where: { discountSetId: discountSetId }
      });

      // Delete from Shopify first
      for (const discount of discounts) {
        if (discount.shopifyId && discount.status === 'CREATED') {
          try {
            await admin.graphql(
              `#graphql
                mutation discountCodeDelete($id: ID!) {
                  discountCodeDelete(id: $id) {
                    deletedCodeDiscountId
                    userErrors {
                      field
                      message
                    }
                  }
                }`,
              {
                variables: { id: discount.shopifyId }
              }
            );
          } catch (error) {
            console.error(`Failed to delete discount ${discount.code}:`, error);
          }
        }
      }

      // Delete from database (cascade will handle discount records)
      await db.discountSet.delete({
        where: { id: discountSetId }
      });

      return {
        success: true,
        message: "Discount set deleted successfully"
      };
    }

    if (action === "delete_single_discount") {
      const discountId = formData.get("discountId");

      const discount = await db.discount.findUnique({
        where: { id: discountId }
      });

      if (discount?.shopifyId && discount.status === 'CREATED') {
        try {
          await admin.graphql(
            `#graphql
              mutation discountCodeDelete($id: ID!) {
                discountCodeDelete(id: $id) {
                  deletedCodeDiscountId
                  userErrors {
                    field
                    message
                  }
                }
              }`,
            {
              variables: { id: discount.shopifyId }
            }
          );
        } catch (error) {
          console.error(`Failed to delete discount ${discount.code}:`, error);
        }
      }

      // Delete from database
      await db.discount.delete({
        where: { id: discountId }
      });

      return {
        success: true,
        message: "Discount deleted successfully"
      };
    }

  } catch (error) {
    console.error("Action error:", error);
    return {
      error: error.message || "An error occurred"
    };
  }

  return { error: "Invalid action" };
};

export default function BulkDiscount() {
  const fetcher = useFetcher();
  const loaderData = useLoaderData();
  const actionData = fetcher.data;

  // Use initial data from loader, not action data for discount sets
  const { discountSets } = loaderData;

  const [masterDiscountId, setMasterDiscountId] = useState("");
  const [discountSetName, setDiscountSetName] = useState("");
  const [csvContent, setCsvContent] = useState("");
  const [parsedCodes, setParsedCodes] = useState([]);
  const [showPreview, setShowPreview] = useState(false);

  const handleCsvChange = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target.result;
      setCsvContent(content);

      // Parse CSV: supports one code per line or comma-separated
      const codes = content
        .split(/[\n,]/) // Split by newlines or commas
        .map(code => code.trim()) // Trim whitespace
        .filter(code => code && code.length > 0) // Remove empty entries
        .filter((code, index, self) => self.indexOf(code) === index); // Remove duplicates

      setParsedCodes(codes);
      setShowPreview(codes.length > 0);
    };
    reader.readAsText(file);
  };

  const handleGenerateDiscounts = () => {
    if (!masterDiscountId || !discountSetName || parsedCodes.length === 0) {
      return;
    }

    fetcher.submit(
      {
        action: "create_discounts",
        masterDiscountId,
        discountSetName,
        codes: JSON.stringify(parsedCodes)
      },
      { method: "POST" }
    );

    // Reset form
    setMasterDiscountId("");
    setDiscountSetName("");
    setCsvContent("");
    setParsedCodes([]);
    setShowPreview(false);
  };

  const handleDeleteDiscountSet = (discountSetId) => {
    if (confirm("Are you sure you want to delete this discount set? This will also delete all discounts in Shopify.")) {
      fetcher.submit(
        {
          action: "delete_discount_set",
          discountSetId
        },
        { method: "POST" }
      );
    }
  };

  const handleDeleteSingleDiscount = (discountId) => {
    if (confirm("Are you sure you want to delete this discount?")) {
      fetcher.submit(
        {
          action: "delete_single_discount",
          discountId
        },
        { method: "POST" }
      );
    }
  };

  const isLoading = fetcher.state === "submitting";

  return (
    <s-page heading="Bulk Discount Management">

{actionData?.error && (
        <s-banner status="critical">
          {actionData.error}
        </s-banner>
      )}

      {actionData?.success && (
        <s-banner status="success">
          {actionData.message}
        </s-banner>
      )}

      <s-section heading="Create Bulk Discounts">
        <s-form>
          <s-form-field label="Master Discount ID" required>
            <s-text-field
              value={masterDiscountId}
              onChange={(e) => setMasterDiscountId(e.target.value)}
              placeholder="2300842017154 or gid://shopify/DiscountCodeNode/..."
              help-text="Enter just the number (e.g., 2300842017154) from your Shopify discount URL, or the full GraphQL ID"
            />
          </s-form-field>

          <s-form-field label="Discount Set Name" required>
            <s-text-field
              value={discountSetName}
              onChange={(e) => setDiscountSetName(e.target.value)}
              placeholder="Black Friday 2024"
              help-text="A name to organize this group of discounts"
            />
          </s-form-field>

          <s-form-field label="CSV File with Discount Codes" required>
            <input
              type="file"
              accept=".csv,.txt"
              onChange={handleCsvChange}
              style={{
                padding: "8px",
                border: "1px solid #ccc",
                borderRadius: "4px",
                width: "100%"
              }}
            />
            <s-text size="small" color="subdued">
              Upload a CSV file with discount codes. One code per line or comma-separated.
            </s-text>
          </s-form-field>

          {showPreview && (
            <s-section heading={`Preview: ${parsedCodes.length} codes found`}>
              <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
                <s-text size="small">
                  {parsedCodes.slice(0, 10).join(", ")}
                  {parsedCodes.length > 10 && `... and ${parsedCodes.length - 10} more`}
                </s-text>
              </s-box>

              <s-stack direction="inline" gap="base" style={{ marginTop: "16px" }}>
                <s-button
                  onClick={handleGenerateDiscounts}
                  loading={isLoading}
                  disabled={!masterDiscountId || !discountSetName}
                  variant="primary"
                >
                  Generate All Discounts
                </s-button>
                <s-button
                  onClick={() => {
                    setShowPreview(false);
                    setParsedCodes([]);
                    setCsvContent("");
                  }}
                  variant="secondary"
                >
                  Clear
                </s-button>
              </s-stack>
            </s-section>
          )}
        </s-form>
      </s-section>

      <s-section heading="Existing Discount Sets">
        {discountSets.length === 0 ? (
          <s-empty-state heading="No discount sets found">
            Create your first bulk discount set using the form above.
          </s-empty-state>
        ) : (
          <s-stack direction="block" gap="large">
            {discountSets.map((discountSet) => (
              <s-card key={discountSet.id}>
                <s-stack direction="block" gap="base">
                  <s-stack direction="inline" gap="base">
                    <s-heading size="small">{discountSet.name}</s-heading>
                    <s-badge>
                      {discountSet.discounts.length} discount{discountSet.discounts.length !== 1 ? 's' : ''}
                    </s-badge>
                    <s-button
                      onClick={() => handleDeleteDiscountSet(discountSet.id)}
                      variant="secondary"
                      size="small"
                    >
                      Delete Set
                    </s-button>
                  </s-stack>

                  <s-text size="small" color="subdued">
                    Created: {new Date(discountSet.createdAt).toLocaleDateString()}
                  </s-text>

                  {discountSet.discounts.length > 0 && (
                    <s-table>
                      <s-table-head>
                        <s-table-row>
                          <s-table-cell>Code</s-table-cell>
                          <s-table-cell>Status</s-table-cell>
                          <s-table-cell>Created</s-table-cell>
                          <s-table-cell>Error</s-table-cell>
                          <s-table-cell>Actions</s-table-cell>
                        </s-table-row>
                      </s-table-head>
                      <s-table-body>
                        {discountSet.discounts.slice(0, 10).map((discount) => (
                          <s-table-row key={discount.id}>
                            <s-table-cell>{discount.code}</s-table-cell>
                            <s-table-cell>
                              <s-badge variant={
                                discount.status === 'CREATED' ? 'success' :
                                discount.status === 'FAILED' ? 'critical' :
                                'attention'
                              }>
                                {discount.status}
                              </s-badge>
                            </s-table-cell>
                            <s-table-cell>
                              {new Date(discount.createdAt).toLocaleDateString()}
                            </s-table-cell>
                            <s-table-cell>
                              {discount.status === 'FAILED' && discount.errorMessage ? (
                                <s-text size="small" color="critical">
                                  {discount.errorMessage}
                                </s-text>
                              ) : (
                                <s-text size="small" color="subdued">-</s-text>
                              )}
                            </s-table-cell>
                            <s-table-cell>
                              <s-button
                                onClick={() => handleDeleteSingleDiscount(discount.id)}
                                variant="secondary"
                                size="small"
                              >
                                Delete
                              </s-button>
                            </s-table-cell>
                          </s-table-row>
                        ))}
                      </s-table-body>
                    </s-table>
                  )}

                  {discountSet.discounts.length > 10 && (
                    <s-text size="small" color="subdued">
                      ... and {discountSet.discounts.length - 10} more discounts
                    </s-text>
                  )}
                </s-stack>
              </s-card>
            ))}
          </s-stack>
        )}
      </s-section>
    </s-page>
  );
}
