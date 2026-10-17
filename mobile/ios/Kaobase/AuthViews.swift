import SwiftUI

struct LoginView: View {
    @Environment(AppModel.self) private var model
    private enum Mode { case signin, signup, verify, reset, resetCode }
    @State private var mode: Mode = .signin
    @State private var email = ""
    @State private var password = ""
    @State private var code = ""
    @State private var busy = false
    @State private var error: String?
    @State private var notice: String?
    private var needsCode: Bool { mode == .verify || mode == .resetCode }
    private var needsPassword: Bool { mode == .signin || mode == .signup || mode == .resetCode }
    private var title: String {
        switch mode {
        case .signin: "Se connecter"
        case .signup: "Créer mon compte"
        case .verify: "Confirmer mon adresse"
        case .reset: "Recevoir le code"
        case .resetCode: "Enregistrer le mot de passe"
        }
    }
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 26) {
                    HStack { BrandMark().frame(width: 64, height: 70); Text("kaobase").font(.system(size: 38, weight: .medium, design: .serif)) }.padding(.top, 50)
                    VStack(alignment: .leading, spacing: 10) {
                        Text(mode == .signup ? "Tout commence ici." : mode == .signin ? "Tes finances,\nl’esprit tranquille." : title).font(.system(size: 39, weight: .medium, design: .serif))
                        Text(needsCode ? "Saisis le code reçu par e-mail. Vérifie aussi les courriers indésirables." : "Retrouve tes comptes, tes abonnements et tes apps dans un même espace.").foregroundStyle(.secondary)
                    }
                    Panel {
                        TextField("Adresse e-mail", text: $email).textContentType(.emailAddress).keyboardType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled().accessibilityIdentifier("email")
                        if needsCode {
                            Divider()
                            TextField("Code de confirmation", text: $code).textContentType(.oneTimeCode).keyboardType(.numberPad).accessibilityIdentifier("verificationCode")
                        }
                        if needsPassword {
                            Divider()
                            SecureField(mode == .resetCode ? "Nouveau mot de passe" : "Mot de passe", text: $password).textContentType(mode == .signin ? .password : .newPassword).accessibilityIdentifier("password")
                        }
                        InlineError(text: error)
                        if let notice { Text(notice).foregroundStyle(Palette.gain) }
                        BusyButton(title: title, busy: busy) { submit() }.disabled(!valid)
                        if mode == .signin || mode == .signup {
                            Button(mode == .signup ? "J’ai déjà un compte" : "Créer un compte") {
                                mode = mode == .signup ? .signin : .signup; error = nil; notice = nil; password = ""
                            }.frame(maxWidth: .infinity).accessibilityIdentifier("toggleSignup")
                        } else {
                            Button("Revenir à la connexion") { mode = .signin; error = nil; notice = nil; password = ""; code = "" }
                        }
                        if mode == .verify || mode == .resetCode {
                            Button("Renvoyer le code") { resend() }.disabled(busy)
                        }
                    }
                    if mode == .signin { Button("Mot de passe oublié ?") { mode = .reset; error = nil; notice = nil; password = "" } }
                    Text("Ton compte existait avant la migration ? Utilise « Mot de passe oublié » pour définir ton nouveau mot de passe. Tes données sont conservées.").font(.footnote).foregroundStyle(.secondary)
                }.padding(24).frame(maxWidth: 540)
            }.frame(maxWidth: .infinity).background(Palette.paper).foregroundStyle(Palette.ink)
        }
    }
    private var valid: Bool {
        email.contains("@") && (!needsPassword || password.count >= (mode == .signin ? 1 : 8)) && (!needsCode || (code.count == 6 && code.allSatisfy(\.isNumber)))
    }
    private func submit() {
        busy = true; error = nil; notice = nil
        let address = email.trimmingCharacters(in: .whitespacesAndNewlines)
        Task {
            defer { busy = false }
            do {
                guard let client = model.client else { throw AppError.configuration }
                switch mode {
                case .signin, .signup:
                    let signedIn = try await model.authenticate(email: address, password: password, signup: mode == .signup)
                    password = ""
                    if !signedIn { mode = .verify; notice = "Compte créé. Un code de confirmation a été demandé." }
                case .verify:
                    try await client.verifyEmail(email: address, code: code); code = ""; await model.load()
                case .reset:
                    try await client.requestReset(email: address); mode = .resetCode; notice = "Si un compte existe, un code a été envoyé."
                case .resetCode:
                    try await client.resetPassword(email: address, code: code, password: password)
                    password = ""; code = ""; mode = .signin; notice = "Mot de passe enregistré. Connecte-toi."
                }
            } catch AppError.verificationRequired { mode = .verify; password = ""; notice = "Confirme ton adresse avec le code reçu par e-mail." }
            catch { self.error = error.localizedDescription }
        }
    }
    private func resend() {
        busy = true; error = nil
        Task {
            defer { busy = false }
            do {
                guard let client = model.client else { throw AppError.configuration }
                if mode == .verify { try await client.resendVerification(email: email) }
                else { try await client.requestReset(email: email) }
                notice = "Un nouveau code a été demandé."
            } catch { self.error = error.localizedDescription }
        }
    }
}

struct SetupView: View {
    @Environment(AppModel.self) private var model
    @State private var name = ""
    @State private var currency = "EUR"
    @State private var timezone = TimeZone.current.identifier
    @State private var accountName = "Compte courant"
    @State private var accountKind = "checking"
    @State private var balance = "0"
    @State private var space = "perso"
    @State private var busy = false
    @State private var error: String?
    var body: some View {
        NavigationStack {
            Form {
                Section { Text("Bienvenue dans Kaobase.").font(.title2).fontDesign(.serif); Text("Quelques informations pour préparer ton espace.").foregroundStyle(.secondary) }
                Section("Ton profil") {
                    TextField("Prénom ou nom d’affichage", text: $name).textContentType(.givenName)
                    CurrencyPicker(currency: $currency)
                    Picker("Fuseau horaire", selection: $timezone) { ForEach(TimeZone.knownTimeZoneIdentifiers, id: \.self) { Text($0).tag($0) } }
                }
                Section("Ton premier compte") {
                    TextField("Nom du compte", text: $accountName)
                    AccountKindPicker(kind: $accountKind)
                    AmountField(title: "Solde de départ", text: $balance)
                    FormSpacePicker(space: $space)
                }
                Section {
                    InlineError(text: error)
                    BusyButton(title: "Ouvrir mon espace", busy: busy) { save() }.disabled(name.trimmingCharacters(in: .whitespaces).isEmpty || accountName.isEmpty || Money.parse(balance) == nil)
                    Button("Se déconnecter", role: .destructive) { Task { await model.signOut() } }
                }
            }.navigationTitle("À ton image").scrollContentBackground(.hidden).background(Palette.paper)
                .onAppear {
                    name = model.profile?.displayName ?? ""; currency = model.currency
                    timezone = model.profile?.timezone ?? TimeZone.current.identifier
                    if let account = model.setupAccount {
                        accountName = account.name; accountKind = account.kind; space = account.space
                        balance = NSDecimalNumber(decimal: account.openingBalance).stringValue
                    }
                }
        }.interactiveDismissDisabled()
    }
    private func save() {
        guard let value = Money.parse(balance), let client = model.client else { return }
        busy = true; error = nil
        Task {
            defer { busy = false }
            do {
                let _: Success = try await client.request("setup", method: "POST", payload: [
                    "displayName": .string(name), "currency": .string(currency), "timezone": .string(timezone),
                    "accountId": .optional(model.setupAccount?.id), "accountName": .string(accountName), "accountKind": .string(accountKind),
                    "openingBalance": .number(value), "space": .string(space),
                ])
                await model.load()
            } catch { self.error = error.localizedDescription }
        }
    }
}
struct CurrencyPicker: View {
    @Binding var currency: String
    static let codes = ["EUR", "USD", "GBP", "CHF", "CAD", "MAD", "XOF", "XAF", "TND", "DZD"]
    var body: some View { Picker("Devise", selection: $currency) { ForEach(Self.codes, id: \.self) { Text($0).tag($0) } } }
}
struct AccountKindPicker: View {
    @Binding var kind: String
    var body: some View { Picker("Type", selection: $kind) { Text("Compte courant").tag("checking"); Text("Épargne").tag("savings"); Text("Carte").tag("card"); Text("Espèces").tag("cash"); Text("Autre").tag("other") } }
}
