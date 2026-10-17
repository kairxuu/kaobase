import SwiftUI

struct AgentView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.scenePhase) private var scenePhase
    @State private var history = false
    @State private var pending: AgentDeletion?
    @FocusState private var composing: Bool
    @State private var composer = ""
    private let suggestions = ["Résume mes dépenses de ce mois", "Quels abonnements pourrais-je réduire ?", "Quelles tâches dois-je faire ?"]
    var body: some View {
        let chat = model.chat
        NavigationStack {
            VStack(spacing: 0) {
                SpacePicker().padding(.horizontal).padding(.bottom, 10)
                ScrollViewReader { proxy in
                    ScrollView {
                        VStack(alignment: .leading, spacing: 24) {
                            if chat.messages.isEmpty {
                                VStack(alignment: .leading, spacing: 22) {
                                    BrandMark().frame(width: 44, height: 52).padding(.vertical, 12)
                                    Text("On regarde quoi aujourd’hui ?").font(.title.weight(.semibold))
                                    Text("Tes dépenses, tes abonnements ou tes tâches.").foregroundStyle(.secondary)
                                    ForEach(suggestions, id: \.self) { suggestion in
                                        Button { chat.draft = suggestion } label: {
                                            HStack { Text(suggestion).multilineTextAlignment(.leading); Spacer(); Image(systemName: "arrow.up.left") }.padding(12).background(Palette.sheet, in: RoundedRectangle(cornerRadius: 4))
                                        }.buttonStyle(.plain)
                                    }
                                }.padding(.top, 20)
                            }
                            ForEach(chat.messages) { row in
                                VStack(alignment: .leading, spacing: 12) {
                                    Text(row.isUser ? "Toi" : "Kaobase").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                                    Text(.init(row.text)).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
                                    ForEach(row.deletions) { deletion in
                                        VStack(alignment: .leading, spacing: 10) {
                                            Text(deletion.description).font(.callout)
                                            Button("Examiner la suppression", role: .destructive) { pending = deletion }.buttonStyle(.bordered).disabled(chat.busy)
                                        }.padding(12).background(Palette.loss.opacity(0.08), in: RoundedRectangle(cornerRadius: 4))
                                    }
                                }.padding(row.isUser ? 16 : 0)
                                    .background(row.isUser ? Palette.accent.opacity(0.07) : .clear, in: RoundedRectangle(cornerRadius: 4))
                            }
                            if chat.busy { ProgressView("Kaobase réfléchit…").padding(.vertical) }
                            InlineError(text: chat.error)
                            InlineError(text: chat.storageError)
                            Color.clear.frame(height: 1).id("bottom")
                        }.padding(20).frame(maxWidth: 720).frame(maxWidth: .infinity)
                    }.scrollDismissesKeyboard(.interactively).onChange(of: chat.messages.count) { _, _ in withAnimation { proxy.scrollTo("bottom", anchor: .bottom) } }
                        .refreshable { await chat.refreshCurrent() }
                }
                HStack(alignment: .bottom, spacing: 12) {
                    TextField("Demande à Kaobase…", text: $composer, axis: .vertical).lineLimit(1...6)
                        .accessibilityIdentifier("chatDraft").autocorrectionDisabled().focused($composing).padding(14)
                    Button { chat.draft = composer; Task { await chat.send(space: model.space); await model.refresh() } } label: {
                        Image(systemName: "arrow.up").font(.headline).frame(width: 40, height: 40).foregroundStyle(Palette.onAccent).background(Palette.accent, in: RoundedRectangle(cornerRadius: 4))
                    }.accessibilityLabel("Envoyer").disabled(composer.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || chat.busy)
                        .padding(6)
                }.background(Palette.sheet, in: RoundedRectangle(cornerRadius: 4))
                    .overlay(RoundedRectangle(cornerRadius: 4).stroke(Palette.ink.opacity(0.12))).padding(16)
            }.background(Palette.paper).navigationTitle("Assistant IA").navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItemGroup(placement: .keyboard) { Spacer(); Button("Terminé") { composing = false } }
                    ToolbarItem(placement: .topBarLeading) { Button("Historique") { history = true } }
                    ToolbarItem(placement: .topBarTrailing) { Button("Nouvelle conversation", systemImage: "square.and.pencil") { chat.newConversation() }.disabled(chat.sending) }
                }
                .sheet(isPresented: $history) { ConversationHistoryView() }
                .sheet(item: $pending) { deletion in
                    RemovalSheet(title: "Supprimer cet élément ?", detail: deletion.description) {
                        try await chat.decide(deletion, confirm: true); await model.refresh()
                    } cancelAction: { try await chat.decide(deletion, confirm: false) }
                }
                .onAppear { composer = chat.draft }
                .onChange(of: composer) { _, value in if value != chat.draft { chat.draft = value } }
                .onChange(of: chat.draft) { _, value in if value != composer { composer = value } }
                .onChange(of: chat.activeId) { _, _ in composing = false; composer = chat.draft }
                .task { await chat.refreshHistory(); await chat.refreshCurrent() }
                .onChange(of: scenePhase) { _, phase in if phase == .active { Task { await chat.refreshCurrent() } } }
        }
    }
}
struct ConversationHistoryView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var search = ""
    @State private var deleting: ConversationSummary?
    private var rows: [ConversationSummary] { model.chat.entries.filter { search.isEmpty || $0.title.localizedCaseInsensitiveContains(search) } }
    var body: some View {
        NavigationStack {
            List {
                if rows.isEmpty { ContentUnavailableView("Aucune conversation", systemImage: "bubble.left.and.bubble.right", description: Text("Tes échanges et tes brouillons apparaîtront ici.")) }
                ForEach(rows) { row in
                    HStack {
                        Button {
                            Task { await model.chat.select(row.id) }; dismiss()
                        } label: {
                            VStack(alignment: .leading, spacing: 6) {
                                Text(row.title).font(.body.weight(row.id == model.chat.activeId ? .semibold : .regular)).lineLimit(2)
                                Text(String(row.lastAt.prefix(10))).font(.caption).foregroundStyle(.secondary)
                            }.frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 6)
                        }.buttonStyle(.plain)
                        Button("Supprimer", systemImage: "trash") { deleting = row }.labelStyle(.iconOnly).buttonStyle(.borderless).tint(Palette.loss)
                            .disabled(model.chat.sending || model.chat.threads[row.id]?.pendingSince != nil)
                    }
                }
                InlineError(text: model.chat.error)
            }.scrollContentBackground(.hidden).background(Palette.paper)
                .navigationTitle("Historique").navigationBarTitleDisplayMode(.inline)
                .searchable(text: $search, prompt: "Rechercher une conversation")
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Fermer") { dismiss() } } }
                .task { await model.chat.refreshHistory() }
                .sheet(item: $deleting) { row in
                    RemovalSheet(title: "Supprimer cette conversation ?", detail: "« \(row.title) » sera retirée de l’historique. Les souvenirs de l’assistant sont conservés.") { try await model.chat.remove(row.id) }
                }
        }
    }
}
/// A branded confirmation with errors and retry inside the same window.
struct RemovalSheet: View {
    let title: String
    let detail: String
    let action: () async throws -> Void
    var cancelAction: (() async throws -> Void)? = nil
    @Environment(\.dismiss) private var dismiss
    @State private var busy = false
    @State private var error: String?
    var body: some View {
        VStack(alignment: .leading, spacing: 22) {
            Image(systemName: "trash").font(.title2).foregroundStyle(Palette.loss)
            Text(title).font(.title2.weight(.semibold))
            Text(detail).font(.callout).foregroundStyle(.secondary)
            InlineError(text: error)
            Button { run(action) } label: {
                HStack { Spacer(); if busy { ProgressView() }; Text("Confirmer la suppression"); Spacer() }.padding(14).foregroundStyle(.white).background(Palette.loss, in: RoundedRectangle(cornerRadius: 4))
            }.disabled(busy)
            Button(cancelAction == nil ? "Annuler" : "Revenir à la conversation") { dismiss() }.frame(maxWidth: .infinity).disabled(busy)
            if let cancelAction { Button("Annuler la demande de suppression") { run(cancelAction) }.frame(maxWidth: .infinity).disabled(busy) }
        }.padding(28).frame(maxWidth: .infinity).presentationDetents([.medium, .large])
            .presentationDragIndicator(.visible).presentationBackground(Palette.paper).interactiveDismissDisabled(busy)
    }
    private func run(_ operation: @escaping () async throws -> Void) {
        busy = true; error = nil
        Task { defer { busy = false }; do { try await operation(); dismiss() } catch { self.error = error.localizedDescription } }
    }
}
