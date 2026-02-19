import { useState, useEffect } from "react";
import { useFetcher, useLoaderData, useRevalidator } from "react-router";
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
    // STEP 1: Create discount set and save all codes to DB (fast, no Shopify API calls)
    if (action === "create_discounts") {
      const masterDiscountId = formData.get("masterDiscountId");
      const discountSetName = formData.get("discountSetName");
      const codes = JSON.parse(formData.get("codes"));

      // Convert simple ID to GraphQL format if needed
      let formattedMasterDiscountId = masterDiscountId;
      if (!masterDiscountId.startsWith('gid://')) {
        formattedMasterDiscountId = `gid://shopify/DiscountCodeNode/${masterDiscountId}`;
      }

      // Validate the master discount exists before creating anything
      const masterDiscountResponse = await admin.graphql(
        `#graphql
          query getDiscount($id: ID!) {
            discountNode(id: $id) {
              id
              discount {
                ... on DiscountCodeBasic {
                  title
                }
              }
            }
          }`,
        {
          variables: { id: formattedMasterDiscountId }
        }
      );

      const masterDiscountData = await masterDiscountResponse.json();

      if (masterDiscountData.errors) {
        console.error("GraphQL Errors:", masterDiscountData.errors);
        return {
          error: `GraphQL Error: ${masterDiscountData.errors[0].message}. Using ID: ${formattedMasterDiscountId}`
        };
      }

      if (!masterDiscountData.data.discountNode?.discount) {
        return {
          error: `Master discount not found with ID: ${formattedMasterDiscountId}. Please check if the discount exists.`
        };
      }

      // Create discount set in database
      const discountSet = await db.discountSet.create({
        data: {
          name: discountSetName,
          shop: session.shop,
          masterDiscountId: formattedMasterDiscountId
        }
      });

      // Create all discount records as PENDING (batch insert - fast)
      await db.discount.createMany({
        data: codes.map(code => ({
          shop: session.shop,
          code: code,
          masterDiscountId: formattedMasterDiscountId,
          discountSetId: discountSet.id,
          status: 'PENDING'
        }))
      });

      return {
        success: true,
        message: `Queued ${codes.length} discount codes. Processing will begin automatically...`,
        discountSetId: discountSet.id,
        totalCodes: codes.length,
        needsProcessing: true
      };
    }

    // STEP 2: Process pending discounts in batches (called multiple times via polling)
    if (action === "process_pending") {
      const discountSetId = formData.get("discountSetId");
      const BATCH_SIZE = 5; // Process 5 at a time to avoid timeout

      // Fetch the discount set and master discount info
      const discountSet = await db.discountSet.findUnique({
        where: { id: discountSetId }
      });

      if (!discountSet) {
        return { error: "Discount set not found" };
      }

      // Get pending discounts for this set
      const pendingDiscounts = await db.discount.findMany({
        where: {
          discountSetId: discountSetId,
          status: 'PENDING'
        },
        take: BATCH_SIZE
      });

      if (pendingDiscounts.length === 0) {
        // Get final stats
        const stats = await db.discount.groupBy({
          by: ['status'],
          where: { discountSetId: discountSetId },
          _count: true
        });

        const created = stats.find(s => s.status === 'CREATED')?._count || 0;
        const failed = stats.find(s => s.status === 'FAILED')?._count || 0;

        return {
          success: true,
          complete: true,
          message: `Processing complete. Created: ${created}, Failed: ${failed}`,
          processed: 0,
          remaining: 0
        };
      }

      // Fetch master discount details
      const masterDiscountResponse = await admin.graphql(
        `#graphql
          query getDiscount($id: ID!) {
            discountNode(id: $id) {
              id
              discount {
                ... on DiscountCodeBasic {
                  title
                  status
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
                }
              }
            }
          }`,
        {
          variables: { id: discountSet.masterDiscountId }
        }
      );

      const masterDiscountData = await masterDiscountResponse.json();
      const masterDiscount = masterDiscountData.data?.discountNode?.discount;

      if (!masterDiscount) {
        return { error: "Master discount no longer exists" };
      }

      // Helper functions
      const buildItemSelection = () => {
        if (masterDiscount.customerGets.items.allItems) {
          return { all: "ALL" };
        } else if (masterDiscount.customerGets.items.products) {
          const productIds = masterDiscount.customerGets.items.products.edges.map(edge => edge.node.id);
          return { products: { productsToAdd: productIds } };
        } else if (masterDiscount.customerGets.items.collections) {
          const collectionIds = masterDiscount.customerGets.items.collections.edges.map(edge => edge.node.id);
          return { collections: { add: collectionIds } };
        }
        return { all: "ALL" };
      };

      const buildCustomerContext = () => {
        if (masterDiscount.context.all) {
          return { all: "ALL" };
        } else if (masterDiscount.context.customers) {
          return { customers: { add: masterDiscount.context.customers.map(c => c.id) } };
        }
        return { all: "ALL" };
      };

      const itemSelection = buildItemSelection();
      const customerContext = buildCustomerContext();

      // Process batch
      let processedCount = 0;
      for (const discountRecord of pendingDiscounts) {
        try {
          const discountInput = {
            code: discountRecord.code,
            title: masterDiscount.title,
            startsAt: masterDiscount.startsAt,
            endsAt: masterDiscount.endsAt,
            context: customerContext,
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
            usageLimit: masterDiscount.usageLimit,
            appliesOncePerCustomer: masterDiscount.appliesOncePerCustomer
          };

          const createDiscountResponse = await admin.graphql(
            `#graphql
              mutation discountCodeBasicCreate($basicCodeDiscount: DiscountCodeBasicInput!) {
                discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
                  codeDiscountNode {
                    id
                  }
                  userErrors {
                    field
                    message
                  }
                }
              }`,
            {
              variables: { basicCodeDiscount: discountInput }
            }
          );

          const createResult = await createDiscountResponse.json();
          const userErrors = createResult.data?.discountCodeBasicCreate?.userErrors;
          const codeDiscountNode = createResult.data?.discountCodeBasicCreate?.codeDiscountNode;

          if (userErrors?.length > 0) {
            const errorMsg = userErrors.map(e => `${e.field}: ${e.message}`).join(', ');
            await db.discount.update({
              where: { id: discountRecord.id },
              data: { status: 'FAILED', errorMessage: errorMsg }
            });
          } else if (codeDiscountNode) {
            await db.discount.update({
              where: { id: discountRecord.id },
              data: { status: 'CREATED', shopifyId: codeDiscountNode.id }
            });
          } else {
            await db.discount.update({
              where: { id: discountRecord.id },
              data: { status: 'FAILED', errorMessage: 'Unexpected API response' }
            });
          }
          processedCount++;
        } catch (error) {
          console.error(`Error creating ${discountRecord.code}:`, error.message);
          await db.discount.update({
            where: { id: discountRecord.id },
            data: { status: 'FAILED', errorMessage: error.message || 'Unknown error' }
          });
          processedCount++;
        }
      }

      // Get remaining count
      const remainingCount = await db.discount.count({
        where: {
          discountSetId: discountSetId,
          status: 'PENDING'
        }
      });

      return {
        success: true,
        complete: remainingCount === 0,
        processed: processedCount,
        remaining: remainingCount,
        message: remainingCount > 0
          ? `Processed ${processedCount} discounts. ${remainingCount} remaining...`
          : `Batch complete. Processed ${processedCount} discounts.`
      };
    }

    // Retry failed discounts
    if (action === "retry_failed") {
      const discountSetId = formData.get("discountSetId");

      await db.discount.updateMany({
        where: {
          discountSetId: discountSetId,
          status: 'FAILED'
        },
        data: {
          status: 'PENDING',
          errorMessage: null
        }
      });

      const pendingCount = await db.discount.count({
        where: {
          discountSetId: discountSetId,
          status: 'PENDING'
        }
      });

      return {
        success: true,
        message: `${pendingCount} failed discounts have been queued for retry.`,
        discountSetId: discountSetId,
        needsProcessing: pendingCount > 0
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
  const processFetcher = useFetcher();
  const loaderData = useLoaderData();
  const revalidator = useRevalidator();
  const actionData = fetcher.data;
  const processData = processFetcher.data;

  // Use initial data from loader, not action data for discount sets
  const { discountSets } = loaderData;

  const [masterDiscountId, setMasterDiscountId] = useState("");
  const [discountSetName, setDiscountSetName] = useState("");
  const [csvContent, setCsvContent] = useState("");
  const [parsedCodes, setParsedCodes] = useState([]);
  const [showPreview, setShowPreview] = useState(false);

  // Processing state
  const [processingSetId, setProcessingSetId] = useState(null);
  const [processedCount, setProcessedCount] = useState(0);
  const [totalToProcess, setTotalToProcess] = useState(0);
  const [processingMessage, setProcessingMessage] = useState("");

  // Start processing when we receive a needsProcessing response
  useEffect(() => {
    if (actionData?.needsProcessing && actionData?.discountSetId) {
      setProcessingSetId(actionData.discountSetId);
      setTotalToProcess(actionData.totalCodes || 0);
      setProcessedCount(0);
      setProcessingMessage("Starting processing...");
    }
  }, [actionData]);

  // Polling loop for processing pending discounts
  useEffect(() => {
    if (!processingSetId) return;
    if (processFetcher.state === "submitting" || processFetcher.state === "loading") return;

    // Check if processing is complete
    if (processData?.complete) {
      setProcessingMessage(processData.message);
      setProcessingSetId(null);
      // Refresh the data to show updated statuses
      revalidator.revalidate();
      return;
    }

    // Update progress
    if (processData?.processed) {
      setProcessedCount(prev => prev + processData.processed);
      setProcessingMessage(processData.message);
    }

    // Continue processing
    const timer = setTimeout(() => {
      processFetcher.submit(
        {
          action: "process_pending",
          discountSetId: processingSetId
        },
        { method: "POST" }
      );
    }, 500);

    return () => clearTimeout(timer);
  }, [processingSetId, processData, processFetcher.state]);

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

  const handleRetryFailed = (discountSetId) => {
    fetcher.submit(
      {
        action: "retry_failed",
        discountSetId
      },
      { method: "POST" }
    );
  };

  const handleResumeProcessing = (discountSetId) => {
    // Count pending for this set
    const set = discountSets.find(s => s.id === discountSetId);
    const pendingCount = set?.discounts.filter(d => d.status === 'PENDING').length || 0;
    if (pendingCount > 0) {
      setProcessingSetId(discountSetId);
      setTotalToProcess(pendingCount);
      setProcessedCount(0);
      setProcessingMessage("Resuming processing...");
    }
  };

  const isLoading = fetcher.state === "submitting";
  const isProcessing = !!processingSetId;

  return (
    <s-page heading="Bulk Discount Management">

      {actionData?.error && (
        <s-banner status="critical">
          {actionData.error}
        </s-banner>
      )}

      {actionData?.success && !processingSetId && (
        <s-banner status="success">
          {actionData.message}
        </s-banner>
      )}

      {isProcessing && (
        <s-banner status="info">
          <s-stack direction="block" gap="tight">
            <s-text>
              {processingMessage}
            </s-text>
            <s-text size="small" color="subdued">
              Processed: {processedCount} {totalToProcess > 0 && `of ~${totalToProcess}`}
            </s-text>
            <s-progress-bar
              progress={totalToProcess > 0 ? Math.min((processedCount / totalToProcess) * 100, 100) : 0}
            />
          </s-stack>
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
            {discountSets.map((discountSet) => {
              const pendingCount = discountSet.discounts.filter(d => d.status === 'PENDING').length;
              const failedCount = discountSet.discounts.filter(d => d.status === 'FAILED').length;
              const createdCount = discountSet.discounts.filter(d => d.status === 'CREATED').length;
              const isCurrentlyProcessing = processingSetId === discountSet.id;

              return (
              <s-card key={discountSet.id}>
                <s-stack direction="block" gap="base">
                  <s-stack direction="inline" gap="base">
                    <s-heading size="small">{discountSet.name}</s-heading>
                    <s-badge variant="success">{createdCount} created</s-badge>
                    {pendingCount > 0 && <s-badge variant="attention">{pendingCount} pending</s-badge>}
                    {failedCount > 0 && <s-badge variant="critical">{failedCount} failed</s-badge>}
                  </s-stack>

                  <s-text size="small" color="subdued">
                    Created: {new Date(discountSet.createdAt).toLocaleDateString()}
                  </s-text>

                  <s-stack direction="inline" gap="base">
                    {pendingCount > 0 && !isCurrentlyProcessing && (
                      <s-button
                        onClick={() => handleResumeProcessing(discountSet.id)}
                        variant="primary"
                        size="small"
                      >
                        Resume Processing ({pendingCount} pending)
                      </s-button>
                    )}
                    {failedCount > 0 && !isCurrentlyProcessing && (
                      <s-button
                        onClick={() => handleRetryFailed(discountSet.id)}
                        variant="secondary"
                        size="small"
                        disabled={isLoading}
                      >
                        Retry Failed ({failedCount})
                      </s-button>
                    )}
                    <s-button
                      onClick={() => handleDeleteDiscountSet(discountSet.id)}
                      variant="secondary"
                      size="small"
                      disabled={isCurrentlyProcessing}
                    >
                      Delete Set
                    </s-button>
                  </s-stack>

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
              );
            })}
          </s-stack>
        )}
      </s-section>
    </s-page>
  );
}
