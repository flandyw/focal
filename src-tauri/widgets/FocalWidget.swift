import SwiftUI
import WidgetKit

private struct FocalEntry: TimelineEntry {
    let date: Date
    let snapshot: WidgetSnapshot?
}
private struct FocalProvider: TimelineProvider {
    func placeholder(in context: Context) -> FocalEntry { FocalEntry(date: .now, snapshot: .preview) }
    func getSnapshot(in context: Context, completion: @escaping (FocalEntry) -> Void) {
        completion(FocalEntry(date: .now, snapshot: context.isPreview ? .preview : .read()))
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<FocalEntry>) -> Void) {
        let now = Date.now
        let snapshot = WidgetSnapshot.read()
        let horizon = now.addingTimeInterval(2 * 86400)
        var dates = [now]
        for item in (snapshot?.agenda ?? []) + (snapshot?.exams ?? []) {
            dates += [item.date, item.endDate.addingTimeInterval(1)]
        }
        dates += (snapshot?.reviews ?? []).map { Date(timeIntervalSince1970: $0.due / 1000) }
        for offset in 1...2 {
            if let midnight = Calendar.current.date(byAdding: .day, value: offset, to: Calendar.current.startOfDay(for: now)) { dates.append(midnight) }
        }
        let entries = Set(dates.filter { $0 >= now && $0 <= horizon }).sorted().prefix(96).map { FocalEntry(date: $0, snapshot: snapshot) }
        completion(Timeline(entries: entries, policy: .after(now.addingTimeInterval(900))))
    }
}
private enum WidgetStyle {
    case next, exams, study, review
    var tint: Color { switch self { case .next: .indigo; case .exams: .orange; case .study: .teal; case .review: .purple } }
    var label: String { switch self { case .next: "UP NEXT"; case .exams: "COUNTDOWN"; case .study: "STUDY TODAY"; case .review: "REVIEW QUEUE" } }
    var icon: String { switch self { case .next: "calendar"; case .exams: "hourglass"; case .study: "scope"; case .review: "rectangle.on.rectangle" } }
    var destination: String { switch self { case .next: "calendar"; case .exams: "exams"; case .study: "focus"; case .review: "mistakes" } }
}
private struct FocalWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: FocalEntry
    let style: WidgetStyle
    private var small: Bool { family == .systemSmall }
    private var items: [AgendaItem] {
        let source = style == .exams ? entry.snapshot?.exams : entry.snapshot?.agenda
        return (source ?? []).filter { $0.endDate >= entry.date }
    }
    private var reviews: [ReviewCard] { (entry.snapshot?.reviews ?? []).filter { $0.due <= entry.date.timeIntervalSince1970 * 1000 } }
    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack {
                Text(style.label).tracking(1)
                Spacer()
                Image(systemName: style.icon)
            }.font(.system(size: 10, weight: .semibold)).foregroundStyle(style.tint)
            Spacer(minLength: 0)
            if entry.snapshot == nil {
                Text("Your day,\nin focus.").font(.title3.weight(.semibold))
                Text("Open Focal and sign in to sync your widgets.").font(.caption).foregroundStyle(.secondary)
            } else {
                switch style {
                case .next: nextContent
                case .exams: examContent
                case .study: studyContent
                case .review: reviewContent
                }
            }
            Spacer(minLength: 0)
            if let snapshot = entry.snapshot {
                HStack(spacing: 3) {
                    Text("Focal").fontWeight(.medium)
                    Spacer()
                    if entry.date.timeIntervalSince1970 - snapshot.updatedAt / 1000 > 7200 { Text("Open to update") }
                    else { Text("Updated"); Text(Date(timeIntervalSince1970: snapshot.updatedAt / 1000), style: .time) }
                }.font(.system(size: 9)).foregroundStyle(.tertiary).lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .containerBackground(.background, for: .widget)
        .widgetURL(URL(string: "focal://view/\(entry.snapshot == nil ? "settings" : ((style == .next || style == .exams) ? items.first?.view : nil) ?? style.destination)"))
        .privacySensitive()
    }
    @ViewBuilder private var nextContent: some View {
        if let next = items.first {
            let layout = family == .systemLarge ? AnyLayout(VStackLayout(alignment: .leading, spacing: 18)) : AnyLayout(HStackLayout(alignment: .top, spacing: 16))
            layout {
                VStack(alignment: .leading, spacing: 3) {
                    Group {
                        if next.allDay == true {
                            if Calendar.current.isDate(next.date, inSameDayAs: entry.date) { Text("Today") }
                            else { Text(next.date, format: .dateTime.day().month(.abbreviated)) }
                        }
                        else if next.date <= entry.date { Text("Now").foregroundStyle(style.tint) }
                        else if Calendar.current.isDate(next.date, inSameDayAs: entry.date) { Text(next.date, style: .time) }
                        else { Text(next.date, format: .dateTime.weekday(.abbreviated).hour().minute()) }
                    }.font(.system(size: small ? 25 : 28, weight: .semibold, design: .rounded)).minimumScaleFactor(0.6).lineLimit(1)
                    Text(next.title).font(.system(size: 14, weight: .semibold)).lineLimit(2)
                    if !next.subtitle.isEmpty { Text(next.subtitle).font(.system(size: 11)).foregroundStyle(.secondary).lineLimit(1) }
                }.frame(maxWidth: .infinity, alignment: .leading)
                if !small && items.count > 1 {
                    VStack(alignment: .leading, spacing: 10) {
                        ForEach(Array(items.dropFirst().prefix(family == .systemLarge ? 5 : 2))) { item in
                            HStack(spacing: 8) {
                                Capsule().fill(style.tint.opacity(0.4)).frame(width: 2)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(item.title).font(.system(size: 11, weight: .medium)).lineLimit(1)
                                    Text(item.date, format: .dateTime.weekday(.abbreviated).hour().minute()).font(.system(size: 10)).foregroundStyle(.secondary)
                                }
                            }.fixedSize(horizontal: false, vertical: true)
                        }
                    }.frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        } else { empty("All clear", detail: "No upcoming classes or events.") }
    }
    @ViewBuilder private var examContent: some View {
        if let exam = items.first {
            let days = max(0, Calendar.current.dateComponents([.day], from: Calendar.current.startOfDay(for: entry.date), to: Calendar.current.startOfDay(for: exam.date)).day ?? 0)
            HStack(alignment: .center, spacing: 20) {
                VStack(alignment: .leading, spacing: 1) {
                    Text(days == 0 ? "Today" : "\(days)").font(.system(size: days == 0 ? 31 : (small ? 36 : 42), weight: .semibold, design: .rounded)).foregroundStyle(style.tint).minimumScaleFactor(0.7).lineLimit(1)
                    if days > 0 { Text(days == 1 ? "day to go" : "days to go").font(.system(size: 11)).foregroundStyle(.secondary) }
                    if small { Text(exam.title).font(.system(size: 13, weight: .semibold)).lineLimit(2) }
                }
                if !small {
                    VStack(alignment: .leading, spacing: 5) {
                        Text(exam.title).font(.headline).lineLimit(2)
                        Text(exam.subtitle).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                        Group {
                            if exam.allDay == true { Text(exam.date, format: .dateTime.day().month(.abbreviated)) }
                            else { Text(exam.date, format: .dateTime.day().month(.abbreviated).hour().minute()) }
                        }.font(.caption2).foregroundStyle(.secondary)
                    }.frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        } else { empty("Room to breathe", detail: "No upcoming assessments.") }
    }
    private var studyContent: some View {
        let day = entry.snapshot?.currentDay(entry.date)
        let minutes = day?.minutes ?? 0
        let target = day?.target ?? 0
        return HStack(spacing: 16) {
            VStack(spacing: 4) {
              ZStack {
                Circle().stroke(style.tint.opacity(0.13), lineWidth: 7)
                Circle().trim(from: 0, to: target > 0 ? min(1, minutes / target) : 0).stroke(style.tint, style: StrokeStyle(lineWidth: 7, lineCap: .round)).rotationEffect(.degrees(-90))
                VStack(spacing: 0) {
                    Text("\(Int(minutes))").font(.system(size: 29, weight: .semibold, design: .rounded)).minimumScaleFactor(0.6).lineLimit(1)
                    Text("min").font(.system(size: 10)).foregroundStyle(.secondary)
                }
              }.frame(width: small ? 72 : 78, height: small ? 72 : 78)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("\(Int(minutes)) minutes studied. " + (target > 0 ? "\(Int(target)) minute daily goal." : "No daily goal set."))
              if small { Text(target > 0 ? "\(Int(target)) min goal" : "No daily target").font(.system(size: 9)).foregroundStyle(.secondary) }
            }.frame(maxWidth: small ? .infinity : nil)
            if !small {
                VStack(alignment: .leading, spacing: 7) {
                    Text(target > 0 ? (minutes >= target ? "Daily goal reached" : "\(Int(max(0, target - minutes))) min to your goal") : "Every minute counts").font(.system(size: 13, weight: .semibold)).lineLimit(2)
                    Text(target > 0 ? "\(Int(minutes)) of \(Int(target)) minutes" : "Study at your own pace").font(.caption2).foregroundStyle(.secondary)
                    HStack(alignment: .bottom, spacing: 4) {
                        ForEach(Array((entry.snapshot?.days ?? []).filter { $0.date <= (day?.date ?? "") }.suffix(7).enumerated()), id: \.offset) { _, value in
                            Capsule().fill(style.tint.opacity(value.date == day?.date ? 1 : 0.3)).frame(height: max(3, min(18, 18 * value.minutes / max(1, value.target))))
                                .accessibilityLabel("\(value.date): \(Int(value.minutes)) minutes")
                        }
                    }.frame(height: 18)
                }.frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }
    private var reviewContent: some View {
        let groups = Dictionary(grouping: reviews, by: \.subject).sorted { $0.value.count == $1.value.count ? $0.key < $1.key : $0.value.count > $1.value.count }
        return HStack(spacing: 20) {
            VStack(alignment: .leading, spacing: 2) {
                Text("\(reviews.count)").font(.system(size: 46, weight: .semibold, design: .rounded)).foregroundStyle(style.tint)
                Text(reviews.count == 1 ? "card ready" : "cards ready").font(.system(size: 12, weight: .medium))
                if reviews.isEmpty { Text("You're all caught up.").font(.caption2).foregroundStyle(.secondary) }
            }
            if !small && !groups.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(Array(groups.prefix(3)), id: \.key) { subject, cards in
                        HStack { Text(subject).lineLimit(1); Spacer(); Text("\(cards.count)").monospacedDigit().foregroundStyle(style.tint) }.font(.system(size: 11, weight: .medium))
                    }
                }.frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }
    private func empty(_ title: String, detail: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.system(size: 17, weight: .semibold))
            Text(detail).font(.caption).foregroundStyle(.secondary)
        }
    }
}
private func configuration(_ kind: String, _ title: String, _ detail: String, _ style: WidgetStyle) -> some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: FocalProvider()) { FocalWidgetView(entry: $0, style: style) }
        .configurationDisplayName(title).description(detail)
        .supportedFamilies(style == .next ? [.systemSmall, .systemMedium, .systemLarge] : [.systemSmall, .systemMedium])
}
private struct UpNextWidget: Widget {
    var body: some WidgetConfiguration { configuration("com.andy.focal.widget", "Up Next", "Your next class, event, or assessment, at a glance.", .next) }
}
private struct ExamWidget: Widget {
    var body: some WidgetConfiguration { configuration("com.andy.focal.exams", "Exam Countdown", "Stay ready for your next exam or SAC.", .exams) }
}
private struct StudyWidget: Widget {
    var body: some WidgetConfiguration { configuration("com.andy.focal.study", "Study Today", "Minutes studied and progress toward your daily goal.", .study) }
}
private struct ReviewWidget: Widget {
    var body: some WidgetConfiguration { configuration("com.andy.focal.review", "Review Queue", "Spaced repetition cards ready for review, by subject.", .review) }
}
@main
struct FocalWidgets: WidgetBundle {
    var body: some Widget {
        UpNextWidget()
        ExamWidget()
        StudyWidget()
        ReviewWidget()
    }
}
