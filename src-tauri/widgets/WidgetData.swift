import Foundation
import Darwin

struct AgendaItem: Codable, Identifiable {
    let id, title, subtitle: String
    let start, end: Double
    let view: String
    let allDay: Bool?
    var date: Date { Date(timeIntervalSince1970: start / 1000) }
    var endDate: Date { Date(timeIntervalSince1970: end / 1000) }
}
struct StudyDay: Codable {
    let date: String
    let minutes, target: Double
}
struct ReviewCard: Codable {
    let subject: String
    let due: Double
}
struct WidgetSnapshot: Codable {
    let version: Int
    let updatedAt: Double
    let agenda, exams: [AgendaItem]
    let days: [StudyDay]
    let reviews: [ReviewCard]

    static func fileURL() throws -> URL {
        guard let home = getpwuid(getuid())?.pointee.pw_dir else { throw CocoaError(.fileReadNoSuchFile) }
        // ponytail: one read-only file supports ad-hoc signing; use an App Group when signing with a team.
        return URL(fileURLWithPath: String(cString: home), isDirectory: true)
            .appendingPathComponent("Library/Application Support/com.andy.focal/widgets.json")
    }
    static func read() -> Self? {
        guard let url = try? fileURL(), let data = try? Data(contentsOf: url), data.count <= 512 * 1024,
              let value = try? JSONDecoder().decode(Self.self, from: data), value.version == 1 else { return nil }
        return value
    }
    func currentDay(_ date: Date) -> StudyDay? {
        let parts = Calendar.current.dateComponents([.year, .month, .day], from: date)
        let key = String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
        return days.first { $0.date == key }
    }
    static var preview: Self {
        let now = Date.now
        let next = AgendaItem(id: "class", title: "Mathematical Methods", subtitle: "Room 12 · Period 3", start: now.addingTimeInterval(1200).timeIntervalSince1970 * 1000, end: now.addingTimeInterval(4800).timeIntervalSince1970 * 1000, view: "timetable", allDay: nil)
        let exam = AgendaItem(id: "exam", title: "Chemistry", subtitle: "VCE examination", start: now.addingTimeInterval(8 * 86400).timeIntervalSince1970 * 1000, end: now.addingTimeInterval(8 * 86400 + 7200).timeIntervalSince1970 * 1000, view: "exams", allDay: nil)
        let parts = Calendar.current.dateComponents([.year, .month, .day], from: now)
        let day = String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
        return Self(version: 1, updatedAt: now.timeIntervalSince1970 * 1000, agenda: [next, exam], exams: [exam], days: [StudyDay(date: day, minutes: 42, target: 60)], reviews: (0..<12).map { ReviewCard(subject: $0 < 7 ? "Chemistry" : "Methods", due: 0) })
    }
}
