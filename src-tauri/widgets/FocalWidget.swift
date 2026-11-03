import SwiftUI
import WidgetKit

private struct FocalEntry: TimelineEntry {
    let date: Date
}

private struct FocalProvider: TimelineProvider {
    func placeholder(in context: Context) -> FocalEntry {
        FocalEntry(date: .now)
    }

    func getSnapshot(in context: Context, completion: @escaping (FocalEntry) -> Void) {
        completion(FocalEntry(date: .now))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<FocalEntry>) -> Void) {
        // ponytail: static packaging probe; add data and scheduled entries after CI installs work.
        completion(Timeline(entries: [FocalEntry(date: .now)], policy: .never))
    }
}

private struct FocalWidgetView: View {
    let entry: FocalEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Focal", systemImage: "scope")
                .font(.headline)
                .foregroundStyle(.secondary)
            Spacer(minLength: 0)
            Text("Ready to focus.")
                .font(.title2.weight(.semibold))
                .minimumScaleFactor(0.8)
            Text("Native widget preview")
                .font(.caption)
                .foregroundStyle(.secondary)
            Text("Built \(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "")")
                .font(.caption2.monospacedDigit())
                .foregroundStyle(.tertiary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .containerBackground(.background, for: .widget)
        .accessibilityElement(children: .combine)
    }
}

@main
struct FocalWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "com.andy.focal.widget", provider: FocalProvider()) { entry in
            FocalWidgetView(entry: entry)
        }
        .configurationDisplayName("Focal Preview")
        .description("A native widget preview to verify Focal’s macOS packaging. Study data is not connected yet.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}
