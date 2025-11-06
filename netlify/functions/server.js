import express from "express";
import fs from "fs";
import path from "path";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

const dataDir = path.resolve("./data");

// 🧮 Helper: Generate date range between two dates
function generateDateRange(start, end) {
  const startDate = new Date(start);
  const endDate = new Date(end);
  const dates = [];
  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    return new Error("Invalid start or end date");
  }
  while (startDate <= endDate) {
    const iso = startDate.toISOString().split("T")[0];
    dates.push(iso);
    startDate.setDate(startDate.getDate() + 1);
  }
  return dates;
}

// 🧾 Helper: Calculate summary
function calculateSummary(allCoverage, allUsage) {
  if (allCoverage.length === 0) {
    return { totalAPIs: 0, avgCoverage: 0, totalCalls: 0 };
  }

  const allApiNames = new Set();
  for (const cov of allCoverage) {
    Object.keys(cov).forEach((n) => allApiNames.add(n));
  }

  let totalCoverage = 0;
  let totalCalls = 0;
  let count = 0;

  for (let i = 0; i < allCoverage.length; i++) {
    const cov = allCoverage[i];
    const use = allUsage[i];
    for (const name of allApiNames) {
      const api = cov[name];
      const usage = use?.find((u) => u.api_name === name);
      if (api) {
        totalCoverage += (api.covered_lines / api.full_size) * 100;
        count++;
      }
      
      if (usage) totalCalls += parseInt(usage.usage_count, 10) || 0;
    }
  }

  return {
    totalAPIs: allApiNames.size,
    avgCoverage: count ? totalCoverage / count : 0,
    totalCalls,
  };
}

// 📡 Endpoint: /summary?start=YYYY-MM-DD&end=YYYY-MM-DD
app.get("/api/summary", async (req, res) => {
  try {
    console.log("Request received at backend!", req.query);
    const { start, end } = req.query;

    if (!start || !end) {
      return res.status(400).json({ error: "Missing start or end date" });
    }

    const inRange = generateDateRange(start, end);
    let allCoverage= [];
    let allUsage= [];

    for (const date of inRange) {
      const coveragePath = path.join(dataDir, `api_coverage_${date}.json`);
      const usagePath = path.join(dataDir, `api_usage_${date}.json`);

      try {
        if (fs.existsSync(coveragePath)) {
          allCoverage.push(JSON.parse(fs.readFileSync(coveragePath, "utf8")));
        }
        if (fs.existsSync(usagePath)) {
          allUsage.push(JSON.parse(fs.readFileSync(usagePath, "utf8")));
        }
      } catch (err) {
        console.warn(`⚠️ Error reading file for ${date}:`, err.message);
      }
    }

    // Make sure calculateSummary can handle empty arrays safely
    const summary = calculateSummary(allCoverage, allUsage) || {
      totalAPIs: 0,
      avgCoverage: 0,
      totalCalls: 0,
    };

    res.json(summary);
  } catch (err) {
    console.error("🔥 Error in /api/summary:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});


// Dedicated API for Coverage vs Usage scatter plot
app.get("/api/coverage-usage", async (req, res) => {
  try {
    const { date } = req.query;
    if (!date) return res.status(400).json({ error: "Missing date" });

    const coveragePath = path.join(dataDir, `api_coverage_${date}.json`);
    const usagePath = path.join(dataDir, `api_usage_${date}.json`);

    const cov = fs.existsSync(coveragePath)
      ? JSON.parse(fs.readFileSync(coveragePath, "utf8"))
      : {};
    const use = fs.existsSync(usagePath)
      ? JSON.parse(fs.readFileSync(usagePath, "utf8"))
      : [];

    const scatterData = [];

    Object.keys(cov).forEach((name) => {
      const api = cov[name];
      const coveragePercent = (api.covered_lines / api.full_size) * 100;
      const usageItem = use.find((u) => u.api_name === name);
      const usageCount = usageItem ? Number(usageItem.usage_count) : 0;

      scatterData.push({ name, coverage: coveragePercent, usage: usageCount });
    });

    res.json({ data: scatterData });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});


app.get("/api/coverage-trends", async (req, res) => {
  try {
    const { start, end } = req.query;
    if (!start || !end) return res.status(400).json({ error: "Missing start or end date" });

    const inRange = generateDateRange(start, end);

    const trends= [];

    for (const date of inRange) {
      const coveragePath = path.join(dataDir, `api_coverage_${date}.json`);
      if (!fs.existsSync(coveragePath)) continue;

      const cov = JSON.parse(fs.readFileSync(coveragePath, "utf8"));
      const apiNames = Object.keys(cov);

      if (apiNames.length === 0) continue;

      let totalCoverage = 0;
      apiNames.forEach((name) => {
        const api = cov[name];
        totalCoverage += (api.covered_lines / api.full_size) * 100;
      });

      trends.push({
        date,
        avgCoverage: totalCoverage / apiNames.length,
      });
    }

    res.json({ data: trends });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});



app.get("/api/apis", async (req, res) => {
  try {
    const { date } = req.query;
    if (!date) return res.status(400).json({ error: "Missing date" });

    const coveragePath = path.join(dataDir, `api_coverage_${date}.json`);
    const usagePath = path.join(dataDir, `api_usage_${date}.json`);

    const cov = fs.existsSync(coveragePath)
      ? JSON.parse(fs.readFileSync(coveragePath, "utf8"))
      : {};
    const use = fs.existsSync(usagePath)
      ? JSON.parse(fs.readFileSync(usagePath, "utf8"))
      : [];

    const data = Object.keys(cov).map((name) => {
      const api = cov[name];
      const usageItem = use.find((u) => u.api_name === name);
      const usageCount = usageItem ? Number(usageItem.usage_count) : 0;
      const totalClients = usageItem ? Number(usageItem.total_clients) : 0;

      return {
        name,
        coverage: ((api.covered_lines / api.full_size) * 100).toFixed(1),
        usage: usageCount,
        totalClients,
        apidoc: api.apidoc,
        fullSize: api.full_size,
        coveredLines: api.covered_lines,
      };
    });

    res.json({ data });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});


export const handler = serverless(app);
