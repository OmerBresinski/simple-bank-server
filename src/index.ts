import express, { RequestHandler } from "express";
import cors from "cors";
import dotenv from "dotenv";
import axios from "axios";

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// Truelayer configuration
const TRUELAYER_AUTH_URL =
  process.env.TRUELAYER_ENV === "production"
    ? "https://auth.truelayer.com"
    : "https://auth.truelayer-sandbox.com";

const TRUELAYER_API_URL =
  process.env.TRUELAYER_ENV === "production"
    ? "https://api.truelayer.com"
    : "https://api.truelayer-sandbox.com";

// Middleware
app.use(cors());
app.use(express.json());

// Truelayer endpoints
const createTruelayerAuthLink: RequestHandler = async (req, res, next) => {
  try {
    console.log("=== Starting Truelayer Auth Link Creation ===");
    console.log("1. Checking environment variables...");

    // Validate required environment variables
    const requiredEnvVars = [
      "TRUELAYER_CLIENT_ID",
      "TRUELAYER_CLIENT_SECRET",
      "TRUELAYER_REDIRECT_URI",
      "TRUELAYER_ENV",
    ];

    const missingVars = requiredEnvVars.filter(
      (varName) => !process.env[varName]
    );
    if (missingVars.length > 0) {
      throw new Error(
        `Missing required environment variables: ${missingVars.join(", ")}`
      );
    }

    console.log("Environment variables check passed");
    console.log("TRUELAYER_ENV:", process.env.TRUELAYER_ENV);
    console.log("TRUELAYER_AUTH_URL:", TRUELAYER_AUTH_URL);
    console.log("TRUELAYER_CLIENT_ID:", process.env.TRUELAYER_CLIENT_ID);
    console.log("TRUELAYER_REDIRECT_URI:", process.env.TRUELAYER_REDIRECT_URI);

    // Generate the auth URL directly - no token needed for initial auth
    console.log("2. Generating auth URL...");
    const nonce = Math.random().toString(36).substring(2, 15);
    const state = Math.random().toString(36).substring(2, 15);

    const authParams = {
      response_type: "code",
      client_id: process.env.TRUELAYER_CLIENT_ID!,
      scope: "info accounts balance cards transactions",
      redirect_uri: process.env.TRUELAYER_REDIRECT_URI!,
      providers: "uk-ob-all uk-oauth-all",
      state,
      nonce,
    };

    console.log("Auth parameters:", authParams);

    const authUrl =
      `${TRUELAYER_AUTH_URL}/?` + new URLSearchParams(authParams).toString();

    console.log("3. Auth URL generated successfully:", authUrl);
    console.log("=== Truelayer Auth Link Creation Complete ===");

    res.json({ authUrl, state, nonce });
  } catch (error: any) {
    console.error("=== Truelayer Auth Link Creation Failed ===");
    console.error("Error details:", {
      name: error.name,
      message: error.message,
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data,
      stack: error.stack,
    });

    if (error.response?.data) {
      console.error("Truelayer API Error:", error.response.data);
    }

    res.status(500).json({
      error: "Failed to create Truelayer auth link",
      details: error.response?.data || error.message,
      status: error.response?.status,
    });
  }
};

// Update the exchangeTruelayerCode function to use the correct API URL
const exchangeTruelayerCode: RequestHandler = async (req, res, next) => {
  try {
    const { code } = req.body;

    // Create Basic Auth header
    const credentials = Buffer.from(
      `${process.env.TRUELAYER_CLIENT_ID}:${process.env.TRUELAYER_CLIENT_SECRET}`
    ).toString("base64");

    console.log("Exchanging code for token...");
    console.log("Using URL:", `${TRUELAYER_AUTH_URL}/connect/token`);
    console.log("With credentials:", credentials);

    const response = await axios.post(
      `${TRUELAYER_AUTH_URL}/connect/token`,
      new URLSearchParams({
        grant_type: "authorization_code",
        redirect_uri: process.env.TRUELAYER_REDIRECT_URI!,
        code,
      }).toString(),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${credentials}`,
        },
      }
    );

    console.log("Token exchange successful:", response.data);
    res.json(response.data);
  } catch (error: any) {
    console.error(
      "Truelayer Token Exchange Error:",
      error.response?.data || error.message
    );
    console.error("Error details:", {
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data,
    });
    res.status(500).json({
      error: "Failed to exchange authorization code",
      details: error.response?.data || error.message,
    });
  }
};

// Get Truelayer accounts
const getTruelayerAccounts: RequestHandler = async (req, res, next) => {
  try {
    const { accessToken } = req.body;

    const response = await axios.get(`${TRUELAYER_API_URL}/data/v1/accounts`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    res.json(response.data);
  } catch (error: any) {
    console.error(
      "Truelayer Accounts Error:",
      error.response?.data || error.message
    );
    res.status(500).json({ error: "Failed to fetch accounts" });
  }
};

// Get Truelayer transactions
const getTruelayerTransactions: RequestHandler = async (req, res, next) => {
  try {
    const { accessToken, accountId } = req.body;

    // Calculate current month's date range
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    // Calculate start of current month
    const startOfCurrentMonth = new Date(currentYear, currentMonth, 1);
    startOfCurrentMonth.setHours(0, 0, 0, 0);

    // Use current date instead of end of month
    const endDate = new Date(now);
    endDate.setHours(23, 59, 59, 999);

    const response = await axios.get(
      `${TRUELAYER_API_URL}/data/v1/accounts/${accountId}/transactions`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        params: {
          from: startOfCurrentMonth.toISOString(),
          to: endDate.toISOString(),
        },
      }
    );

    res.json(response.data);
  } catch (error: any) {
    console.error(
      "Truelayer Transactions Error:",
      error.response?.data || error.message
    );
    res.status(500).json({ error: "Failed to fetch transactions" });
  }
};

// Add Truelayer routes
app.post("/api/truelayer/auth", createTruelayerAuthLink);
app.post("/api/truelayer/exchange", exchangeTruelayerCode);
app.post("/api/truelayer/accounts", getTruelayerAccounts);
app.post("/api/truelayer/transactions", getTruelayerTransactions);

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
  console.log(`TrueLayer Environment: ${process.env.TRUELAYER_ENV}`);
});
