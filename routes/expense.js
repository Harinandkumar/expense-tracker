const express = require("express");
const Expense = require("../models/Expense");

const router = express.Router();

// Add Expense
router.post("/add", async (req, res) => {
  const { title, amount, category } = req.body;
  try {
    await new Expense({
      userId: req.session.userId,
      title,
      amount,
      category
    }).save();
    res.redirect("/expenses/list");
  } catch (err) {
    res.send("Error: " + err.message);
  }
});

// List Expenses
router.get("/list", async (req, res) => {
  const expenses = await Expense.find({ userId: req.session.userId }).sort({ date: -1 });
  res.render("expenses", { expenses });
});

// Delete Expense
router.get("/delete/:id", async (req, res) => {
  try {
    await Expense.deleteOne({ _id: req.params.id, userId: req.session.userId });
    res.redirect("/expenses/list");
  } catch (err) {
    res.send("Error: " + err.message);
  }
});

// ✅ Edit Expense Form (Debugged)
router.get("/edit/:id", async (req, res) => {
  console.log("UserID:", req.session.userId, "ExpenseID:", req.params.id);
  try {
    const expense = await Expense.findOne({
      _id: req.params.id,
      userId: req.session.userId
    });
    console.log("Expense found:", expense);
    if (!expense) return res.send("Expense not found or not authorized");
    res.render("editExpense", { expense });
  } catch (err) {
    res.send("Error: " + err.message);
  }
});

// Update Expense
router.post("/edit/:id", async (req, res) => {
  const { title, amount, category } = req.body;
  try {
    await Expense.updateOne(
      { _id: req.params.id, userId: req.session.userId },
      { title, amount, category }
    );
    res.redirect("/expenses/list");
  } catch (err) {
    res.send("Error: " + err.message);
  }
});

// Charts / Analytics (Debugged)
router.get("/charts", async (req, res) => {
  try {
    const expenses = await Expense.find({ userId: req.session.userId });
    
    // Category totals
    const categoryTotals = {};
    expenses.forEach(e => {
      categoryTotals[e.category] = (categoryTotals[e.category] || 0) + e.amount;
    });

    // Monthly totals
    const monthlyTotals = {};
    expenses.forEach(e => {
      const month = e.date.toLocaleString('default', { month: 'short', year: 'numeric' });
      monthlyTotals[month] = (monthlyTotals[month] || 0) + e.amount;
    });

    res.render("charts", { categoryTotals, monthlyTotals });
  } catch (err) {
    res.send("Error: " + err.message);
  }
});

module.exports = router;
