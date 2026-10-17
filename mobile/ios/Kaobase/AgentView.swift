import SwiftUI

struct AgentView: View {
    @Environment(AppModel.self) private var model
    @State private var messages: [ChatMessage] = []
    @State private var message = ""
    @State private var conversationId = UUID().uuidString
    @State private var busy = false
    @State private var error: String?
    @State private var pending: AgentDeletion?
    @State private var deciding = false
    private let suggestions = ["Résume mes dépenses de ce mois", "Quels abonnements pourrais-je réduire ?", "Quelles tâches dois-je faire ?"]
    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                SpacePicker().padding(.horizontal).padding(.bottom, 10)
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 20) {
                            if messages.isEmpty {
                                VStack(alignment: .leading, spacing: 22) {
                                    Image(systemName: "sparkles").font(.largeTitle).foregroundStyle(Palette.accent)
                                    Text("Un peu d’aide,\nbeaucoup de clarté.").font(.system(size: 32, weight: .medium, design: .serif))
                                    Text("Pose une question sur tes finances ou demande un coup de main pour organiser ton quotidien.").foregroundStyle(.secondary)
                                    ForEach(suggestions, id: \.self) { suggestion in Button(suggestion) { message = suggestion; send() }.buttonStyle(.bordered).disabled(busy) }
                                }.padding(.top, 28)
                            }
                            ForEach(messages) { row in
                                VStack(alignment: .leading, spacing: 10) {
                                    Text(row.isUser ? "TOI" : "KAOBASE").font(.caption2.weight(.semibold)).tracking(1.5).foregroundStyle(.secondary)
                                    Text(.init(row.text)).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
                                    ForEach(row.deletions) { deletion in
                                        VStack(alignment: .leading, spacing: 10) {
                                            Label(deletion.description, systemImage: "exclamationmark.circle").font(.callout)
                                            HStack { Button("Confirmer la suppression", role: .destructive) { pending = deletion }.buttonStyle(.bordered); Button("Annuler") { decide(deletion, confirm: false) } }.disabled(deciding || busy)
                                        }.padding(12).background(Palette.loss.opacity(0.08), in: RoundedRectangle(cornerRadius: 14))
                                    }
                                }.padding(16).background(row.isUser ? Palette.accent.opacity(0.08) : Palette.sheet, in: RoundedRectangle(cornerRadius: 20)).id(row.id)
                            }
                            if busy { ProgressView("Kaobase réfléchit…").padding(.vertical) }
                            InlineError(text: error)
                            Color.clear.frame(height: 1).id("bottom")
                        }.padding(20).frame(maxWidth: 720)
                    }.onChange(of: messages.count) { _, _ in withAnimation { proxy.scrollTo("bottom", anchor: .bottom) } }
                }
                HStack(alignment: .bottom, spacing: 12) {
                    TextField("Demande à Kaobase…", text: $message, axis: .vertical).lineLimit(1...5).padding(12).background(Palette.sheet, in: RoundedRectangle(cornerRadius: 18))
                    Button("Envoyer", systemImage: "arrow.up.circle.fill") { send() }.font(.title).labelStyle(.iconOnly).disabled(message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || busy || message.count > 4000)
                }.padding().background(Palette.paper)
            }.background(Palette.paper).navigationTitle("Assistant").navigationBarTitleDisplayMode(.inline)
                .toolbar { Button("Nouvelle conversation", systemImage: "square.and.pencil") { reset() }.disabled(busy || deciding) }
                .onChange(of: model.space) { _, _ in reset() }
                .confirmationDialog("Supprimer cet élément ?", isPresented: Binding(get: { pending != nil }, set: { if !$0 { pending = nil } }), titleVisibility: .visible) {
                    Button("Confirmer la suppression", role: .destructive) { guard let row = pending else { return }; pending = nil; decide(row, confirm: true) }
                } message: { Text(pending?.description ?? "") }
        }
    }
    private func reset() { messages = []; conversationId = UUID().uuidString; error = nil }
    private func send() {
        let text = message.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, text.count <= 4000, !busy else { return }
        guard !model.isDemo else { error = "Connecte-toi pour discuter avec l’assistant."; return }
        message = ""; busy = true; error = nil
        messages.append(ChatMessage(text: text, isUser: true))
        let conversation = conversationId
        Task {
            defer { busy = false }
            do {
                guard let client = model.client else { throw AppError.configuration }
                let reply: AgentReply = try await client.request("agents", method: "POST", payload: ["message": .string(text), "conversationId": .string(conversation), "agent": .string("auto"), "space": .string(model.space)])
                guard conversation == conversationId else { return }
                messages.append(ChatMessage(text: reply.text, isUser: false, deletions: reply.deletions))
                await model.refresh()
            } catch { self.error = error.localizedDescription; message = text }
        }
    }
    private func decide(_ deletion: AgentDeletion, confirm: Bool) {
        deciding = true; error = nil
        Task {
            defer { deciding = false }
            do {
                try await model.mutate("agents/decision", payload: ["requestId": .string(deletion.id), "conversationId": .string(conversationId), "decision": .string(confirm ? "confirm" : "cancel")])
                for index in messages.indices { messages[index].deletions.removeAll { $0.id == deletion.id } }
                messages.append(ChatMessage(text: confirm ? "Suppression confirmée." : "Suppression annulée.", isUser: false))
            } catch { self.error = error.localizedDescription }
        }
    }
}
