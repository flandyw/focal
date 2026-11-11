import AppKit
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
        // Without data, retry soon: a reload request from the app can be throttled by WidgetKit.
        completion(Timeline(entries: entries, policy: .after(now.addingTimeInterval(snapshot == nil ? 120 : 900))))
    }
}
private extension Color {
    // Mirrors --primary and --card in src/index.css so widgets match the app in both themes.
    static let focal = adaptive(light: (0x0b, 0x4c, 0x37), dark: (0xa9, 0xcb, 0xb6))
    static let focalCard = adaptive(light: (0xfd, 0xfc, 0xf8), dark: (0x22, 0x29, 0x25))
    static func adaptive(light: (Int, Int, Int), dark: (Int, Int, Int)) -> Color {
        Color(nsColor: NSColor(name: nil) { appearance in
            let (r, g, b) = appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? dark : light
            return NSColor(srgbRed: CGFloat(r) / 255, green: CGFloat(g) / 255, blue: CGFloat(b) / 255, alpha: 1)
        })
    }
}
private enum WidgetStyle {
    case next, exams, study, review, atar
    var label: String { switch self { case .next: "Up next"; case .exams: "Countdown"; case .study: "Study today"; case .review: "Review"; case .atar: "ATAR" } }
    var icon: String { switch self { case .next: "calendar"; case .exams: "hourglass"; case .study: "scope"; case .review: "rectangle.on.rectangle"; case .atar: "chart.xyaxis.line" } }
    var destination: String { switch self { case .next: "calendar"; case .exams: "exams"; case .study: "focus"; case .review: "mistakes"; case .atar: "atar" } }
}
private func daysUntil(_ date: Date, from now: Date) -> Int {
    let calendar = Calendar.current
    return max(0, calendar.dateComponents([.day], from: calendar.startOfDay(for: now), to: calendar.startOfDay(for: date)).day ?? 0)
}
private func weekday(_ key: String) -> String {
    let parts = key.split(separator: "-").compactMap { Int($0) }
    guard parts.count == 3, let date = Calendar.current.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2])) else { return "" }
    return date.formatted(.dateTime.weekday(.narrow))
}
private struct FocalWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: FocalEntry
    let style: WidgetStyle
    private var small: Bool { family == .systemSmall }
    private var large: Bool { family == .systemLarge }
    private var items: [AgendaItem] {
        let source = style == .exams ? entry.snapshot?.exams : entry.snapshot?.agenda
        return (source ?? []).filter { $0.endDate >= entry.date }
    }
    private var nowMs: Double { entry.date.timeIntervalSince1970 * 1000 }
    private var reviews: [ReviewCard] { (entry.snapshot?.reviews ?? []).filter { $0.due <= nowMs } }
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 5) {
                Image(systemName: style.icon).foregroundStyle(Color.focal).widgetAccentable()
                Text(style.label)
                Spacer(minLength: 0)
            }.font(.system(size: 11, weight: .semibold)).foregroundStyle(.secondary).accessibilityAddTraits(.isHeader)
            Spacer(minLength: 6)
            if entry.snapshot == nil {
                message("Open Focal", detail: "Click to open Focal. This widget fills in once you're signed in.")
            } else {
                switch style {
                case .next: nextContent
                case .exams: examContent
                case .study: studyContent
                case .review: reviewContent
                case .atar: atarContent
                }
            }
            Spacer(minLength: 0)
            if let snapshot = entry.snapshot, entry.date.timeIntervalSince1970 - snapshot.updatedAt / 1000 > 7200 {
                Label("Open Focal to refresh", systemImage: "arrow.clockwise")
                    .font(.system(size: 9, weight: .medium)).foregroundStyle(.secondary).lineLimit(1).padding(.top, 6)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .containerBackground(Color.focalCard, for: .widget)
        .widgetURL(URL(string: "focal://view/\(entry.snapshot == nil ? "settings" : ((style == .next || style == .exams) ? items.first?.view : nil) ?? style.destination)"))
        .privacySensitive()
    }

    // MARK: Up next
    @ViewBuilder private var nextContent: some View {
        if let next = items.first {
            if large {
                VStack(alignment: .leading, spacing: 14) {
                    hero(next)
                    if items.count > 1 {
                        Divider()
                        list(Array(items.dropFirst().prefix(6)), title: "Later")
                    }
                }
            } else if small {
                hero(next)
            } else {
                HStack(alignment: .top, spacing: 16) {
                    hero(next).frame(maxWidth: .infinity, alignment: .leading)
                    if items.count > 1 { list(Array(items.dropFirst().prefix(3)), title: "Later").frame(maxWidth: .infinity, alignment: .leading) }
                }
            }
        } else { message("All clear", detail: "No upcoming classes or events.") }
    }
    private func hero(_ next: AgendaItem) -> some View {
        let live = next.allDay != true && next.date <= entry.date
        let today = Calendar.current.isDate(next.date, inSameDayAs: entry.date)
        return VStack(alignment: .leading, spacing: 2) {
            Group {
                if live { Text("Now").foregroundStyle(Color.focal) }
                else if next.allDay == true { today ? Text("Today") : Text(next.date, format: .dateTime.weekday(.abbreviated).day()) }
                else if today { Text(next.date, format: .dateTime.hour().minute()) }
                else { Text(next.date, format: .dateTime.weekday(.abbreviated).hour().minute()) }
            }.font(.system(size: small ? 26 : 30, weight: .semibold)).monospacedDigit().minimumScaleFactor(0.6).lineLimit(1).widgetAccentable()
            Group {
                if live { Text("Until ") + Text(next.endDate, format: .dateTime.hour().minute()) }
                else if today && next.allDay != true { Text("In ") + Text(next.date, style: .relative) }
                else { Text(next.date, format: .dateTime.day().month(.wide)) }
            }.font(.system(size: 11)).monospacedDigit().foregroundStyle(.secondary).lineLimit(1)
            Text(next.title).font(.system(size: 14, weight: .semibold)).lineLimit(2).padding(.top, 6)
            if !next.subtitle.isEmpty { Text(next.subtitle).font(.system(size: 11)).foregroundStyle(.secondary).lineLimit(1) }
        }
    }
    private func list(_ rows: [AgendaItem], title: String) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(title).font(.system(size: 10, weight: .semibold)).foregroundStyle(.tertiary)
            ForEach(rows) { item in
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(item.title).font(.system(size: 12, weight: .medium)).lineLimit(1)
                    Spacer(minLength: 4)
                    Group {
                        if item.allDay == true { Text(item.date, format: .dateTime.weekday(.abbreviated).day()) }
                        else if Calendar.current.isDate(item.date, inSameDayAs: entry.date) { Text(item.date, format: .dateTime.hour().minute()) }
                        else { Text(item.date, format: .dateTime.weekday(.abbreviated).hour().minute()) }
                    }.font(.system(size: 11)).monospacedDigit().foregroundStyle(.secondary).lineLimit(1).layoutPriority(1)
                }.accessibilityElement(children: .combine)
            }
        }
    }

    // MARK: Countdown
    @ViewBuilder private var examContent: some View {
        if let exam = items.first {
            let days = daysUntil(exam.date, from: entry.date)
            HStack(alignment: .top, spacing: 18) {
                VStack(alignment: .leading, spacing: 2) {
                    HStack(alignment: .firstTextBaseline, spacing: 4) {
                        Text(days == 0 ? "Today" : "\(days)").font(.system(size: days == 0 ? 30 : 44, weight: .semibold)).monospacedDigit()
                            .foregroundStyle(Color.focal).widgetAccentable().minimumScaleFactor(0.6).lineLimit(1)
                        if days > 0 { Text(days == 1 ? "day" : "days").font(.system(size: 13, weight: .medium)).foregroundStyle(.secondary) }
                    }
                    Text(exam.title).font(.system(size: 14, weight: .semibold)).lineLimit(2).padding(.top, 4)
                    Text(exam.subtitle).font(.system(size: 11)).foregroundStyle(.secondary).lineLimit(1)
                    if !small {
                        Group {
                            if exam.allDay == true { Text(exam.date, format: .dateTime.weekday(.abbreviated).day().month(.abbreviated)) }
                            else { Text(exam.date, format: .dateTime.weekday(.abbreviated).day().month(.abbreviated).hour().minute()) }
                        }.font(.system(size: 11)).monospacedDigit().foregroundStyle(.secondary).lineLimit(1)
                    }
                }.frame(maxWidth: .infinity, alignment: .leading)
                if !small && items.count > 1 {
                    VStack(alignment: .leading, spacing: 7) {
                        Text("Then").font(.system(size: 10, weight: .semibold)).foregroundStyle(.tertiary)
                        ForEach(Array(items.dropFirst().prefix(3))) { item in
                            let left = daysUntil(item.date, from: entry.date)
                            HStack(alignment: .firstTextBaseline, spacing: 8) {
                                Text(item.title).font(.system(size: 12, weight: .medium)).lineLimit(1)
                                Spacer(minLength: 4)
                                Text(left == 0 ? "Today" : left == 1 ? "1 day" : "\(left) days").font(.system(size: 11)).monospacedDigit().foregroundStyle(.secondary).layoutPriority(1)
                            }.accessibilityElement(children: .combine)
                        }
                    }.frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        } else { message("Room to breathe", detail: "No upcoming exams or SACs.") }
    }

    // MARK: Study today
    private var studyContent: some View {
        let day = entry.snapshot?.currentDay(entry.date)
        let minutes = day?.minutes ?? 0
        let target = day?.target ?? 0
        let week = Array((entry.snapshot?.days ?? []).filter { $0.date <= (day?.date ?? "") }.suffix(7))
        let peak = max(1, week.map { max($0.minutes, $0.target) }.max() ?? 1)
        return HStack(alignment: .center, spacing: 18) {
            ZStack {
                Circle().stroke(Color.focal.opacity(0.14), lineWidth: 6)
                Circle().trim(from: 0, to: target > 0 ? min(1, minutes / target) : 0)
                    .stroke(Color.focal, style: StrokeStyle(lineWidth: 6, lineCap: .round)).rotationEffect(.degrees(-90)).widgetAccentable()
                VStack(spacing: 0) {
                    Text("\(Int(minutes))").font(.system(size: 26, weight: .semibold)).monospacedDigit().minimumScaleFactor(0.6).lineLimit(1)
                    Text(target > 0 ? "of \(Int(target)) min" : "min").font(.system(size: 9)).monospacedDigit().foregroundStyle(.secondary).lineLimit(1)
                }.padding(.horizontal, 8)
            }
            .frame(width: small ? 84 : 80, height: small ? 84 : 80)
            .frame(maxWidth: small ? .infinity : nil)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("\(Int(minutes)) minutes studied. " + (target > 0 ? "\(Int(target)) minute daily goal." : "No daily goal set."))
            if !small {
                VStack(alignment: .leading, spacing: 10) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(target > 0 ? (minutes >= target ? "Goal reached" : "\(Int(target - minutes)) min to go") : "No goal today")
                            .font(.system(size: 14, weight: .semibold)).lineLimit(1)
                        Text(target > 0 ? "Daily goal \(Int(target)) min" : "Every minute counts").font(.system(size: 11)).foregroundStyle(.secondary).lineLimit(1)
                    }
                    HStack(alignment: .bottom, spacing: 5) {
                        ForEach(week, id: \.date) { value in
                            VStack(spacing: 3) {
                                RoundedRectangle(cornerRadius: 2)
                                    .fill(Color.focal.opacity(value.date == day?.date ? 1 : 0.35))
                                    .frame(height: max(3, 26 * value.minutes / peak))
                                    .frame(maxHeight: 26, alignment: .bottom)
                                    .widgetAccentable()
                                Text(weekday(value.date)).font(.system(size: 8, weight: value.date == day?.date ? .bold : .regular)).foregroundStyle(.secondary)
                            }
                            .frame(maxWidth: .infinity)
                            .accessibilityElement(children: .ignore)
                            .accessibilityLabel("\(value.date): \(Int(value.minutes)) minutes")
                        }
                    }
                }.frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }

    // MARK: Review
    private var reviewContent: some View {
        let groups = Dictionary(grouping: reviews, by: \.subject).sorted { $0.value.count == $1.value.count ? $0.key < $1.key : $0.value.count > $1.value.count }
        let nextDue = (entry.snapshot?.reviews ?? []).map(\.due).filter { $0 > nowMs }.min().map { Date(timeIntervalSince1970: $0 / 1000) }
        return HStack(alignment: .top, spacing: 18) {
            VStack(alignment: .leading, spacing: 2) {
                Text("\(reviews.count)").font(.system(size: 44, weight: .semibold)).monospacedDigit()
                    .foregroundStyle(Color.focal).widgetAccentable().minimumScaleFactor(0.6).lineLimit(1)
                Text(reviews.count == 1 ? "card due" : "cards due").font(.system(size: 13, weight: .medium))
                if reviews.isEmpty {
                    Group {
                        if let nextDue { Text("Next in ") + Text(nextDue, style: .relative) } else { Text("All caught up") }
                    }.font(.system(size: 11)).foregroundStyle(.secondary).lineLimit(1)
                }
            }.frame(maxWidth: small ? .infinity : nil, alignment: .leading)
            if !small && !groups.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(Array(groups.prefix(3)), id: \.key) { subject, cards in
                        VStack(alignment: .leading, spacing: 3) {
                            HStack(alignment: .firstTextBaseline) {
                                Text(subject).lineLimit(1)
                                Spacer(minLength: 4)
                                Text("\(cards.count)").monospacedDigit().foregroundStyle(.secondary)
                            }.font(.system(size: 12, weight: .medium))
                            ProgressView(value: Double(cards.count), total: Double(reviews.count)).tint(Color.focal).widgetAccentable()
                        }.accessibilityElement(children: .combine)
                    }
                }.frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }

    // MARK: ATAR
    @ViewBuilder private var atarContent: some View {
        if let atar = entry.snapshot?.atar {
            let gap = atar.target.flatMap { target in atar.atar.map { target - $0 } }
            VStack(alignment: .leading, spacing: small ? 6 : 8) {
                HStack(alignment: .bottom) {
                    VStack(alignment: .leading, spacing: 1) {
                        Text("Estimated rank").font(.system(size: 10, weight: .medium)).foregroundStyle(.secondary)
                        Text(atar.label).font(.system(size: large ? 48 : 40, weight: .semibold)).monospacedDigit()
                            .foregroundStyle(Color.focal).widgetAccentable().minimumScaleFactor(0.6).lineLimit(1)
                        if !small, let change = atar.change, abs(change) >= 0.005 {
                            Text("\(change > 0 ? "▲" : "▼") \(String(format: "%.2f", abs(change))) since last estimate")
                                .font(.system(size: 9)).foregroundStyle(.secondary).lineLimit(1)
                        }
                    }
                    if !small, let target = atar.target {
                        Spacer(minLength: 8)
                        VStack(alignment: .trailing, spacing: 3) {
                            Text("Target").font(.system(size: 10, weight: .medium)).foregroundStyle(.secondary)
                            Text(target, format: .number.precision(.fractionLength(2))).font(.system(size: 20, weight: .medium)).monospacedDigit()
                            if let gap { Text(gap > 0 ? String(format: "%.2f to go", gap) : "Target reached").font(.system(size: 9)).foregroundStyle(.secondary) }
                        }.padding(.bottom, 6)
                    }
                }
                if let target = atar.target, let value = atar.atar, target > 0 {
                    ProgressView(value: min(value, target), total: target).tint(Color.focal).widgetAccentable()
                        .accessibilityLabel("\(Int(min(1, value / target) * 100)) percent of target ATAR")
                }
                if small {
                    HStack {
                        Text(atar.target == nil ? "Aggregate" : "Target")
                        Spacer(minLength: 4)
                        Text(atar.target ?? atar.aggregate ?? 0, format: .number.precision(.fractionLength(2))).monospacedDigit()
                    }.font(.system(size: 11, weight: .medium)).foregroundStyle(.secondary)
                } else {
                    let primary = atar.subjects.filter { !$0.increment }.reduce(0) { $0 + $1.contribution }
                    let increments = atar.subjects.filter(\.increment).reduce(0) { $0 + $1.contribution }
                    HStack(alignment: .firstTextBaseline) {
                        metric("Aggregate", atar.aggregate)
                        // Subjects are empty when hidden on Focal's ATAR page.
                        if !atar.subjects.isEmpty {
                            Spacer()
                            metric("Primary four", primary)
                            Spacer()
                            metric("Increments", increments)
                        }
                    }
                    if large && !atar.subjects.isEmpty {
                        Divider()
                        VStack(alignment: .leading, spacing: 6) {
                            HStack { Text("Subjects"); Spacer(); Text("Scaled · Weight") }.font(.system(size: 10, weight: .semibold)).foregroundStyle(.tertiary)
                            ForEach(Array(atar.subjects.enumerated()), id: \.offset) { _, subject in
                                HStack(spacing: 8) {
                                    Text(subject.name).font(.system(size: 12, weight: .medium)).lineLimit(1)
                                    Spacer(minLength: 4)
                                    Text(subject.scaled, format: .number.precision(.fractionLength(1))).font(.system(size: 12)).monospacedDigit()
                                    Text(subject.increment ? "10%" : "100%").font(.system(size: 10)).monospacedDigit().foregroundStyle(.secondary).frame(width: 32, alignment: .trailing)
                                }.accessibilityElement(children: .combine)
                            }
                        }
                    }
                    if large { Text((atar.source.map { $0 + " · " } ?? "") + "\(String(atar.year)) VTAC · estimate only").font(.system(size: 9)).foregroundStyle(.secondary).lineLimit(1) }
                }
            }
        } else { message("No estimate yet", detail: "Choose what this shows on Focal's ATAR page.") }
    }
    private func metric(_ name: String, _ value: Double?) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(name).font(.system(size: 9)).foregroundStyle(.secondary)
            Group { if let value { Text(value, format: .number.precision(.fractionLength(2))) } else { Text("—") } }
                .font(.system(size: 14, weight: .semibold)).monospacedDigit()
        }.accessibilityElement(children: .combine)
    }

    private func message(_ title: String, detail: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.system(size: 15, weight: .semibold))
            Text(detail).font(.system(size: 11)).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
        }
    }
}
private func configuration(_ kind: String, _ title: String, _ detail: String, _ style: WidgetStyle) -> some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: FocalProvider()) { FocalWidgetView(entry: $0, style: style) }
        .configurationDisplayName(title).description(detail)
        .supportedFamilies(style == .next || style == .atar ? [.systemSmall, .systemMedium, .systemLarge] : [.systemSmall, .systemMedium])
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
private struct AtarWidget: Widget {
    var body: some WidgetConfiguration { configuration("com.andy.focal.atar", "ATAR", "Your projected ATAR, target and scaled subjects.", .atar) }
}
@main
struct FocalWidgets: WidgetBundle {
    var body: some Widget {
        UpNextWidget()
        ExamWidget()
        StudyWidget()
        ReviewWidget()
        AtarWidget()
    }
}
