import SwiftUI

struct LoginView: View {
    @Environment(AppModel.self) private var model
    @State private var email = ""
    @State private var password = ""
    @State private var signup = false
    @State private var busy = false
    @State private var error: String?
    @State private var confirmation = false
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 26) {
                    HStack { BrandMark().frame(width: 64, height: 70); Text("kaobase").font(.system(size: 38, weight: .medium, design: .serif)) }.padding(.top, 50)
                    VStack(alignment: .leading, spacing: 10) {
                        Text(signup ? "Tout commence ici." : "Tes finances,\nl’esprit tranquille.").font(.system(size: 39, weight: .medium, design: .serif))
                        Text(signup ? "Crée ton compte, puis configure ton espace en quelques instants." : "Retrouve tes comptes, tes abonnements et tes apps dans un même espace.").foregroundStyle(.secondary)
                    }
                    Panel {
                        TextField("Adresse e-mail", text: $email).textContentType(.emailAddress).keyboardType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled().accessibilityIdentifier("email")
                        Divider()
                        SecureField("Mot de passe", text: $password).textContentType(signup ? .newPassword : .password).accessibilityIdentifier("password")
                        InlineError(text: error)
                        if confirmation { Text("Ouvre le lien reçu par e-mail, puis connecte-toi ici.").foregroundStyle(Palette.gain) }
                        BusyButton(title: signup ? "Créer mon compte" : "Se connecter", busy: busy) { submit() }.disabled(!valid)
                        Button(signup ? "J’ai déjà un compte" : "Créer un compte") {
                            signup.toggle(); error = nil; confirmation = false
                        }.frame(maxWidth: .infinity).accessibilityIdentifier("toggleSignup")
                    }
                    if let url = model.website?.appendingPathComponent("auth/reset") { Link("Mot de passe oublié ?", destination: url).font(.callout) }
                    Text("Les mêmes identifiants que sur Kaobase web.").font(.footnote).foregroundStyle(.secondary)
                }.padding(24).frame(maxWidth: 540)
            }.frame(maxWidth: .infinity).background(Palette.paper).foregroundStyle(Palette.ink)
        }
    }
    private var valid: Bool { email.contains("@") && password.count >= (signup ? 8 : 1) }
    private func submit() {
        busy = true; error = nil; confirmation = false
        let loginEmail = email.trimmingCharacters(in: .whitespacesAndNewlines)
        let loginPassword = password
        Task {
            defer { busy = false }
            do {
                let signedIn = try await model.authenticate(email: loginEmail, password: loginPassword, signup: signup)
                password = ""
                if !signedIn { signup = false; confirmation = true }
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
