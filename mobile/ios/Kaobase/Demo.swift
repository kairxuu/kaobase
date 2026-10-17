#if DEBUG
import Foundation

/// Explicit simulator preview; never used as a fallback for real network data.
enum Demo {
    static let profile = Profile(id: "preview", displayName: "Alex", currency: "EUR", timezone: "Europe/Paris", onboardingCompletedAt: "2026-10-17", email: "apercu@example.test")
    static let overview = Overview(
        accounts: [Account(id: "checking", name: "Compte courant", kind: "checking", currency: "EUR", space: "perso", balance: 2486.75), Account(id: "savings", name: "Épargne", kind: "savings", currency: "EUR", space: "perso", balance: 4200)],
        categories: [Category(id: "food", name: "Alimentation", kind: "expense", color: "#4433e0"), Category(id: "transport", name: "Transport", kind: "expense", color: "#1d7348")],
        summary: MonthSummary(month: "2026-10", income: 2850, expenses: 1163.25, net: 1686.75, count: 18, byCategory: [CategoryTotal(categoryId: "food", name: "Alimentation", color: "#4433e0", total: 326.8), CategoryTotal(categoryId: "transport", name: "Transport", color: "#1d7348", total: 89.5), CategoryTotal(categoryId: nil, name: "Loisirs", color: "#8a5a00", total: 63)]),
        budgets: [Budget(categoryId: "food", category: "Alimentation", limit: 400, spent: 326.8, remaining: 73.2, percent: 82)],
        transactions: [Transaction(id: "tx1", accountId: "checking", bookedAt: "2026-10-17", amount: -42.6, labelRaw: "Courses du samedi", merchant: "SUPERMARCHÉ", categoryId: "food", categorizedBy: "user", source: "manual"), Transaction(id: "tx2", accountId: "checking", bookedAt: "2026-10-16", amount: -23.5, labelRaw: "Déjeuner en ville", merchant: "RESTAURANT", categoryId: "food", categorizedBy: "user", source: "manual"), Transaction(id: "tx3", accountId: "checking", bookedAt: "2026-10-15", amount: 2850, labelRaw: "Salaire octobre", merchant: "SALAIRE", categoryId: nil, categorizedBy: nil, source: "manual")],
        subscriptions: [Subscription(id: "sub1", name: "Spotify", amount: 11.99, period: "monthly", nextDue: "2026-10-25", status: "active", space: "perso")],
        tasks: [KaobaseTask(id: "task1", title: "Vérifier l’abonnement de sport", description: nil, status: "todo", priority: "high", dueDate: "2026-10-22", space: "perso")],
        apps: [AppShortcut(id: "app1", name: "Notion", url: "https://www.notion.so", accountLabel: "Personnel", category: "work", space: "perso", pinned: true), AppShortcut(id: "app2", name: "Gmail", url: "https://mail.google.com", accountLabel: "Personnel", category: "communication", space: "perso", pinned: true), AppShortcut(id: "app3", name: "Spotify", url: "https://open.spotify.com", accountLabel: "Personnel", category: "entertainment", space: "perso", pinned: true)],
        connections: []
    )
}
#endif
