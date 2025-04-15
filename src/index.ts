import express, { RequestHandler } from "express";
import cors from "cors";
import dotenv from "dotenv";
import {
  Configuration,
  PlaidApi,
  PlaidEnvironments,
  CountryCode,
  Products,
} from "plaid";

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// Validate required environment variables
const requiredEnvVars = ["PLAID_CLIENT_ID", "PLAID_SECRET", "PLAID_ENV"];
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`Missing required environment variable: ${envVar}`);
    process.exit(1);
  }
}

// Initialize Plaid client
const configuration = new Configuration({
  basePath:
    PlaidEnvironments[process.env.PLAID_ENV as keyof typeof PlaidEnvironments],
  baseOptions: {
    headers: {
      "PLAID-CLIENT-ID": process.env.PLAID_CLIENT_ID,
      "PLAID-SECRET": process.env.PLAID_SECRET,
    },
  },
});

const plaidClient = new PlaidApi(configuration);

// Middleware
app.use(cors());
app.use(express.json());

// Routes
const createLinkToken: RequestHandler = async (req, res, next) => {
  try {
    const configs = {
      user: {
        client_user_id: "user-id",
      },
      client_name: "Simple Bank",
      products: (process.env.PLAID_PRODUCTS || "").split(",") as Products[],
      country_codes: (process.env.PLAID_COUNTRY_CODES || "").split(
        ","
      ) as CountryCode[],
      language: "en",
      webhook: process.env.PLAID_WEBHOOK_URL,
    };

    const response = await plaidClient.linkTokenCreate(configs);
    res.json(response.data);
  } catch (error) {
    console.error("Error creating link token:", error);
    res.status(500).json({ error: "Failed to create link token" });
  }
};

const exchangePublicToken: RequestHandler = async (req, res, next) => {
  try {
    const { public_token } = req.body;
    const response = await plaidClient.itemPublicTokenExchange({
      public_token,
    });
    res.json(response.data);
  } catch (error) {
    console.error("Error exchanging public token:", error);
    res.status(500).json({ error: "Failed to exchange public token" });
  }
};

const getTransactions: RequestHandler = async (req, res, next) => {
  try {
    const { access_token } = req.query;

    if (!access_token) {
      res.status(400).json({ error: "Access token is required" });
      return;
    }

    // Get the current date and date 30 days ago
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 30);

    const response = await plaidClient.transactionsGet({
      access_token: access_token as string,
      start_date: startDate.toISOString().split("T")[0],
      end_date: endDate.toISOString().split("T")[0],
      options: {
        count: 100,
        offset: 0,
        include_personal_finance_category: true,
      },
    });

    // Log the response for debugging
    console.log("Transactions Response:", {
      total_transactions: response.data.total_transactions,
      transactions_count: response.data.transactions?.length,
      item_id: response.data.item?.item_id,
      request_id: response.data.request_id,
    });

    // Return only the transactions array
    res.json(response.data.transactions || []);
  } catch (error: any) {
    console.error("Error fetching transactions:", error);

    // Handle specific Plaid errors
    if (error.response?.data) {
      res.status(error.response.status || 500).json(error.response.data);
      return;
    }

    res.status(500).json({
      error: "Failed to fetch transactions",
      message: error.message,
    });
  }
};

app.post("/api/create_link_token", createLinkToken);
app.post("/api/exchange_public_token", exchangePublicToken);
app.get("/api/transactions", getTransactions);

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
  console.log(`Plaid Environment: ${process.env.PLAID_ENV}`);
});
