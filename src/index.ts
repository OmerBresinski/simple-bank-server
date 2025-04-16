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

// Update the exchangeTruelayerCode function to store refresh token
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

// Add refresh token endpoint
const refreshTruelayerToken: RequestHandler = async (req, res, next) => {
  try {
    const { refresh_token } = req.body;

    // Create Basic Auth header
    const credentials = Buffer.from(
      `${process.env.TRUELAYER_CLIENT_ID}:${process.env.TRUELAYER_CLIENT_SECRET}`
    ).toString("base64");

    console.log("Refreshing token...");
    console.log("Using URL:", `${TRUELAYER_AUTH_URL}/connect/token`);

    const response = await axios.post(
      `${TRUELAYER_AUTH_URL}/connect/token`,
      new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token,
      }).toString(),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${credentials}`,
        },
      }
    );

    console.log("Token refresh successful:", response.data);
    res.json(response.data);
  } catch (error: any) {
    console.error(
      "Truelayer Token Refresh Error:",
      error.response?.data || error.message
    );
    console.error("Error details:", {
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data,
    });
    res.status(500).json({
      error: "Failed to refresh token",
      details: error.response?.data || error.message,
    });
  }
};

// Update the getTruelayerAccounts function to handle token refresh
const getTruelayerAccounts: RequestHandler = async (req, res, next) => {
  try {
    const { accessToken, refreshToken } = req.body;

    try {
      const response = await axios.get(
        `${TRUELAYER_API_URL}/data/v1/accounts`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );
      res.json(response.data);
    } catch (error: any) {
      if (error.response?.status === 401 && refreshToken) {
        // Token expired, try to refresh
        const refreshResponse = await axios.post(
          `${TRUELAYER_AUTH_URL}/connect/token`,
          new URLSearchParams({
            grant_type: "refresh_token",
            refresh_token: refreshToken,
          }).toString(),
          {
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              Authorization: `Basic ${Buffer.from(
                `${process.env.TRUELAYER_CLIENT_ID}:${process.env.TRUELAYER_CLIENT_SECRET}`
              ).toString("base64")}`,
            },
          }
        );

        // Retry the request with the new token
        const retryResponse = await axios.get(
          `${TRUELAYER_API_URL}/data/v1/accounts`,
          {
            headers: {
              Authorization: `Bearer ${refreshResponse.data.access_token}`,
            },
          }
        );

        // Return both the data and the new tokens
        res.json({
          ...retryResponse.data,
          newAccessToken: refreshResponse.data.access_token,
          newRefreshToken: refreshResponse.data.refresh_token,
        });
      } else {
        throw error;
      }
    }
  } catch (error: any) {
    console.error(
      "Truelayer Accounts Error:",
      error.response?.data || error.message
    );
    res.status(500).json({ error: "Failed to fetch accounts" });
  }
};

// Update the getTruelayerTransactions function to handle token refresh
const getTruelayerTransactions: RequestHandler = async (req, res, next) => {
  try {
    const { accessToken, refreshToken, accountId } = req.body;

    // Get current date in UTC
    const now = new Date();
    const startOfCurrentMonth = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
    );

    // Use current time minus 1 minute for end date
    const endDate = new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate(),
        now.getUTCHours(),
        now.getUTCHours() - 1, // Subtract 1 hour
        now.getUTCSeconds(),
        now.getUTCMilliseconds()
      )
    );

    // Format dates to ISO string
    const from = startOfCurrentMonth.toISOString();
    const to = endDate.toISOString();

    console.log("Fetching transactions with date range:", { from, to });

    try {
      const response = await axios.get(
        `${TRUELAYER_API_URL}/data/v1/accounts/${accountId}/transactions`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
          params: {
            from,
            to,
          },
        }
      );
      res.json(response.data);
    } catch (error: any) {
      if (error.response?.status === 401 && refreshToken) {
        // Token expired, try to refresh
        const refreshResponse = await axios.post(
          `${TRUELAYER_AUTH_URL}/connect/token`,
          new URLSearchParams({
            grant_type: "refresh_token",
            refresh_token: refreshToken,
          }).toString(),
          {
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              Authorization: `Basic ${Buffer.from(
                `${process.env.TRUELAYER_CLIENT_ID}:${process.env.TRUELAYER_CLIENT_SECRET}`
              ).toString("base64")}`,
            },
          }
        );

        // Retry the request with the new token
        const retryResponse = await axios.get(
          `${TRUELAYER_API_URL}/data/v1/accounts/${accountId}/transactions`,
          {
            headers: {
              Authorization: `Bearer ${refreshResponse.data.access_token}`,
            },
            params: {
              from,
              to,
            },
          }
        );

        // Return both the data and the new tokens
        res.json({
          ...retryResponse.data,
          newAccessToken: refreshResponse.data.access_token,
          newRefreshToken: refreshResponse.data.refresh_token,
        });
      } else {
        throw error;
      }
    }
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
app.post("/api/truelayer/refresh", refreshTruelayerToken);
app.post("/api/truelayer/accounts", getTruelayerAccounts);
app.post("/api/truelayer/transactions", getTruelayerTransactions);

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
  console.log(`TrueLayer Environment: ${process.env.TRUELAYER_ENV}`);
});
