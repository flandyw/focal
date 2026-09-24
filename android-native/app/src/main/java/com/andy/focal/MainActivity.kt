package com.andy.focal

import android.app.DatePickerDialog
import android.app.TimePickerDialog
import android.os.Bundle
import android.content.Intent
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccessTime
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.ArrowForward
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.EventAvailable
import androidx.compose.material.icons.filled.Headphones
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.SkipNext
import androidx.compose.material.icons.filled.SkipPrevious
import androidx.compose.material.icons.filled.Timer
import androidx.compose.material.icons.filled.Today
import androidx.compose.material.icons.filled.Tune
import androidx.compose.material3.AssistChip
import androidx.compose.material3.AssistChipDefaults
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationRail
import androidx.compose.material3.NavigationRailItem
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Slider
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import org.json.JSONObject
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.YearMonth
import java.time.ZoneId
import java.time.format.DateTimeFormatter

class MainActivity : ComponentActivity() {
    private val model: FocalViewModel by viewModels()
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (BuildConfig.DEBUG) checkNativeLogic()
        setContent { FocalApp(model) }
    }
}

@Composable
private fun FocalApp(vm: FocalViewModel) {
    val dark = androidx.compose.foundation.isSystemInDarkTheme()
    val colors = if (dark) darkColorScheme(
        primary = Color(0xFF9BD2B2), onPrimary = Color(0xFF12382A), primaryContainer = Color(0xFF214B39), onPrimaryContainer = Color(0xFFD3F1DD),
        secondary = Color(0xFFFFB69A), onSecondary = Color(0xFF4A1F10), secondaryContainer = Color(0xFF633522), onSecondaryContainer = Color(0xFFFFDDCF),
        tertiary = Color(0xFFE8C66E), background = Color(0xFF151B17), onBackground = Color(0xFFE8E9DF), surface = Color(0xFF1B221D), onSurface = Color(0xFFE8E9DF),
        surfaceVariant = Color(0xFF303A33), onSurfaceVariant = Color(0xFFB9C5BB)
    ) else lightColorScheme(
        primary = Color(0xFF245C47), onPrimary = Color.White, primaryContainer = Color(0xFF245C47), onPrimaryContainer = Color.White,
        secondary = Color(0xFFD86F4D), onSecondary = Color.White, secondaryContainer = Color(0xFFFFE2D6), onSecondaryContainer = Color(0xFF542312),
        tertiary = Color(0xFFC18A2D), background = Color(0xFFF5F2E9), onBackground = Color(0xFF202820), surface = Color(0xFFFFFEFA), onSurface = Color(0xFF202820),
        surfaceVariant = Color(0xFFE8E8DD), onSurfaceVariant = Color(0xFF606B61), outline = Color(0xFFBBC4B9)
    )
    MaterialTheme(colorScheme = colors, shapes = MaterialTheme.shapes.copy(large = RoundedCornerShape(28.dp), extraLarge = RoundedCornerShape(32.dp))) {
        var tab by rememberSaveable { mutableStateOf(0) }
        val snackbar = remember { SnackbarHostState() }
        val message = vm.message
        LaunchedEffect(message) {
            if (message != null) { snackbar.showSnackbar(message); vm.clearMessage() }
        }
        val owner = LocalLifecycleOwner.current
        DisposableEffect(owner) {
            val observer = LifecycleEventObserver { _, event -> if (event == Lifecycle.Event.ON_RESUME) vm.onResume() }
            owner.lifecycle.addObserver(observer)
            onDispose { owner.lifecycle.removeObserver(observer) }
        }
        val tabs = listOf(
            Triple("Plan", Icons.Filled.CalendarMonth, 0),
            Triple("Focus", Icons.Filled.Timer, 1),
            Triple("Account", Icons.Filled.Tune, 2)
        )
        BoxWithConstraints(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
            // ponytail: single breakpoint keeps one adaptive shell; rail on wide tablet, bar on phones.
            val wide = maxWidth >= 840.dp
            if (wide) {
                Row(Modifier.fillMaxSize()) {
                    NavigationRail(
                        containerColor = MaterialTheme.colorScheme.surface,
                        header = {
                            Surface(color = MaterialTheme.colorScheme.primary, shape = CircleShape, modifier = Modifier.padding(bottom = 16.dp)) {
                                Text("F", Modifier.padding(horizontal = 14.dp, vertical = 8.dp), color = MaterialTheme.colorScheme.onPrimary, fontWeight = FontWeight.ExtraBold, fontSize = 20.sp)
                            }
                        }
                    ) {
                        Spacer(Modifier.weight(0.2f))
                        tabs.forEach { (label, icon, index) ->
                            NavigationRailItem(selected = tab == index, onClick = { tab = index }, icon = { Icon(icon, null) }, label = { Text(label) })
                        }
                    }
                    Box(Modifier.weight(1f).fillMaxHeight()) {
                        Scaffold(containerColor = MaterialTheme.colorScheme.background, snackbarHost = { SnackbarHost(snackbar) }) { padding ->
                            when (tab) {
                                0 -> CalendarScreen(vm, Modifier.padding(padding))
                                1 -> FocusScreen(vm, Modifier.padding(padding))
                                else -> AccountScreen(vm, Modifier.padding(padding))
                            }
                        }
                    }
                }
            } else {
                Scaffold(
                    containerColor = MaterialTheme.colorScheme.background,
                    snackbarHost = { SnackbarHost(snackbar) },
                    bottomBar = {
                        NavigationBar {
                            tabs.forEach { (label, icon, index) ->
                                NavigationBarItem(selected = tab == index, onClick = { tab = index }, icon = { Icon(icon, null) }, label = { Text(label) })
                            }
                        }
                    }
                ) { padding ->
                    when (tab) {
                        0 -> CalendarScreen(vm, Modifier.padding(padding))
                        1 -> FocusScreen(vm, Modifier.padding(padding))
                        else -> AccountScreen(vm, Modifier.padding(padding))
                    }
                }
            }
        }
    }
}

@Composable
private fun PageTitle(kicker: String, title: String, subtitle: String) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.padding(top = 8.dp, bottom = 4.dp)) {
        Text(kicker.uppercase(), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.secondary, fontWeight = FontWeight.ExtraBold, letterSpacing = 1.5.sp)
        Text(title, style = MaterialTheme.typography.headlineLarge, fontWeight = FontWeight.ExtraBold, letterSpacing = (-0.5).sp)
        Text(subtitle, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

private fun eventOnDay(row: FocalRow, day: LocalDate): Boolean = runCatching {
    val start = FocalJson.localDate(row.data.getString("startTime"))
    val end = row.data.optString("endTime").takeIf { it.isNotBlank() }?.let(FocalJson::localDate) ?: start
    !start.isAfter(day) && !end.isBefore(day)
}.getOrDefault(false)

private fun subjectColorHex(vm: FocalViewModel, id: String?): Color? {
    if (id.isNullOrBlank()) return null
    val row = vm.subjects.firstOrNull { it.id == id } ?: return null
    // ponytail: stored colors are 0xAARRGGBB Longs; Color(Int) is the ARGB constructor.
    // Color(ULong) is a packed color-space value and draws garbage/crashes with raw ARGB.
    return Color((row.color and 0xffffffffL).toInt())
}

private fun eventSubjectId(data: JSONObject): String? = data.optString("subjectId").takeIf { it.isNotBlank() }

private fun sessionSubjectId(data: JSONObject): String? = runCatching {
    data.optJSONArray("subjectIds")?.takeIf { it.length() > 0 }?.optString(0)?.takeIf { it.isNotBlank() }
}.getOrNull()

private fun durationText(startIso: String, endIso: String): String = runCatching {
    val mins = Duration.between(Instant.parse(startIso), Instant.parse(endIso)).toMinutes().coerceAtLeast(0)
    if (mins < 60L) "${mins}m" else "${mins / 60}h${if (mins % 60 == 0L) "" else " ${mins % 60}m"}"
}.getOrDefault("")

private fun timeRangeText(data: JSONObject): String {
    val start = data.optString("startTime")
    val end = data.optString("endTime").takeIf { it.isNotBlank() } ?: start
    if (start.isBlank()) return ""
    val range = if (end.isNotBlank() && end != start) "${FocalJson.prettyTime(start)} – ${FocalJson.prettyTime(end)}" else FocalJson.prettyTime(start)
    val dur = if (end.isNotBlank() && end != start) durationText(start, end).let { if (it.isNotBlank()) " · $it" else "" } else ""
    return range + dur
}

// ---------- Calendar ----------

@Composable
private fun CalendarScreen(vm: FocalViewModel, modifier: Modifier = Modifier) {
    var month by remember { mutableStateOf(YearMonth.now()) }
    var day by remember { mutableStateOf(LocalDate.now()) }
    var editor by remember { mutableStateOf<JSONObject?>(null) }
    var create by remember { mutableStateOf(false) }
    var selectedSession by remember { mutableStateOf<JSONObject?>(null) }
    var filter by rememberSaveable { mutableStateOf(0) } // 0 all, 1 events, 2 study
    val allRows = remember(vm.events, vm.sessions) { (vm.events + vm.sessions).sortedBy { it.data.optString("startTime") } }
    val dayRows = remember(allRows, day, filter) {
        allRows.filter { row ->
            eventOnDay(row, day) && when (filter) {
                1 -> row.entity == "events"
                2 -> row.entity != "events"
                else -> true
            }
        }
    }
    val upcoming = remember(vm.events) {
        val now = Instant.now()
        vm.events.filter { row ->
            runCatching { Instant.parse(row.data.optString("endTime").takeIf { it.isNotBlank() } ?: row.data.getString("startTime")) >= now }.getOrDefault(false)
        }.sortedBy { it.data.optString("startTime") }.take(3)
    }

    BoxWithConstraints(modifier.fillMaxSize()) {
        val wide = maxWidth >= 840.dp
        if (wide) {
            Row(Modifier.fillMaxSize().padding(horizontal = 28.dp, vertical = 24.dp), horizontalArrangement = Arrangement.spacedBy(20.dp)) {
                Column(Modifier.width(380.dp).fillMaxHeight().verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                    PageTitle("Make room for what matters", "Your plan", "Month on the left, day on the right.")
                    MonthCard(vm, month, day,
                        onPrev = { month = month.minusMonths(1); day = month.atDay(day.dayOfMonth.coerceAtMost(month.lengthOfMonth())) },
                        onNext = { month = month.plusMonths(1); day = month.atDay(day.dayOfMonth.coerceAtMost(month.lengthOfMonth())) },
                        onToday = { month = YearMonth.now(); day = LocalDate.now() },
                        onPick = { day = it; month = YearMonth.from(it) })
                    FilterCard(filter, onFilter = { filter = it }, eventCount = vm.events.size, sessionCount = vm.sessions.size)
                    UpNextCard(upcoming, onJump = { row ->
                        runCatching { FocalJson.localDate(row.data.getString("startTime")) }.getOrNull()?.let { day = it; month = YearMonth.from(it) }
                    })
                }
                Column(Modifier.weight(1f).fillMaxHeight()) {
                    DayHeader(day, dayRows.size, isToday = day == LocalDate.now(),
                        onToday = { month = YearMonth.now(); day = LocalDate.now() },
                        onNew = { create = true })
                    if (dayRows.isEmpty()) {
                        EmptyDayCard(onNew = { create = true })
                    } else {
                        LazyColumn(verticalArrangement = Arrangement.spacedBy(12.dp), contentPadding = PaddingValues(top = 12.dp, bottom = 24.dp), modifier = Modifier.fillMaxSize()) {
                            items(dayRows, key = { it.entity + it.id }) { row ->
                                AgendaCard(vm, row,
                                    onOpenEvent = { editor = it },
                                    onOpenSession = { selectedSession = it })
                            }
                        }
                    }
                }
            }
        } else {
            Box(Modifier.fillMaxSize()) {
                LazyColumn(contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = 20.dp, bottom = 100.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                    item { PageTitle("Make room for what matters", "Your plan", "A clear view of the days ahead.") }
                    item {
                        MonthCard(vm, month, day,
                            onPrev = { month = month.minusMonths(1); day = month.atDay(day.dayOfMonth.coerceAtMost(month.lengthOfMonth())) },
                            onNext = { month = month.plusMonths(1); day = month.atDay(day.dayOfMonth.coerceAtMost(month.lengthOfMonth())) },
                            onToday = { month = YearMonth.now(); day = LocalDate.now() },
                            onPick = { day = it; month = YearMonth.from(it) })
                    }
                    item { FilterCard(filter, onFilter = { filter = it }, eventCount = vm.events.size, sessionCount = vm.sessions.size) }
                    item {
                        DayHeader(day, dayRows.size, isToday = day == LocalDate.now(),
                            onToday = { month = YearMonth.now(); day = LocalDate.now() }, onNew = { create = true }, compact = true)
                    }
                    if (dayRows.isEmpty()) item { EmptyDayCard(onNew = { create = true }) }
                    items(dayRows, key = { it.entity + it.id }) { row ->
                        AgendaCard(vm, row, onOpenEvent = { editor = it }, onOpenSession = { selectedSession = it })
                    }
                }
                ExtendedFloatingActionButton(onClick = { create = true }, icon = { Icon(Icons.Filled.Add, null) }, text = { Text("New event") },
                    modifier = Modifier.align(Alignment.BottomEnd).padding(20.dp))
            }
        }
    }
    if (create || editor != null) EventEditor(vm, editor, day, onDismiss = { create = false; editor = null })
    if (selectedSession != null) SessionDetailDialog(selectedSession, onDismiss = { selectedSession = null })
}

@Composable
private fun MonthCard(vm: FocalViewModel, month: YearMonth, day: LocalDate, onPrev: () -> Unit, onNext: () -> Unit, onToday: () -> Unit, onPick: (LocalDate) -> Unit) {
    val today = LocalDate.now()
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow), shape = RoundedCornerShape(28.dp)) {
        Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.weight(1f)) {
                    Text(month.format(DateTimeFormatter.ofPattern("MMMM yyyy")), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                    Text("${vm.events.size} events · ${vm.sessions.size} sessions", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                IconButton(onClick = onPrev) { Icon(Icons.Filled.ArrowBack, "Previous month") }
                IconButton(onClick = onToday) { Icon(Icons.Filled.Today, "Jump to today") }
                IconButton(onClick = onNext) { Icon(Icons.Filled.ArrowForward, "Next month") }
            }
            Row { listOf("M", "T", "W", "T", "F", "S", "S").forEach { Text(it, Modifier.weight(1f), textAlign = TextAlign.Center, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant) } }
            val firstOffset = month.atDay(1).dayOfWeek.value - 1
            val slots = firstOffset + month.lengthOfMonth()
            repeat((slots + 6) / 7) { week ->
                Row(horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                    repeat(7) { weekday ->
                        val number = week * 7 + weekday - firstOffset + 1
                        if (number in 1..month.lengthOfMonth()) {
                            val date = month.atDay(number)
                            val hasEvent = vm.events.any { eventOnDay(it, date) }
                            val hasSession = vm.sessions.any { eventOnDay(it, date) }
                            val selected = date == day
                            val isToday = date == today
                            Column(
                                Modifier.weight(1f).heightIn(min = 52.dp).clip(RoundedCornerShape(16.dp))
                                    .background(if (selected) MaterialTheme.colorScheme.primary else Color.Transparent)
                                    .semantics { contentDescription = date.format(DateTimeFormatter.ofPattern("EEEE, d MMMM yyyy")); this.selected = selected }
                                    .clickable { onPick(date) },
                                horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center
                            ) {
                                Text(number.toString(),
                                    color = if (selected) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurface,
                                    style = MaterialTheme.typography.bodyLarge,
                                    fontWeight = if (selected || isToday) FontWeight.Bold else FontWeight.Normal)
                                Row(horizontalArrangement = Arrangement.spacedBy(3.dp), modifier = Modifier.padding(top = 4.dp).height(5.dp)) {
                                    if (hasEvent) Box(Modifier.size(5.dp).background(if (selected) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.primary, CircleShape))
                                    if (hasSession) Box(Modifier.size(5.dp).background(if (selected) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.tertiary, CircleShape))
                                    if (!hasEvent && !hasSession && isToday && !selected) Box(Modifier.size(5.dp).background(MaterialTheme.colorScheme.outline, CircleShape))
                                }
                            }
                        } else Spacer(Modifier.weight(1f))
                    }
                }
            }
        }
    }
}

@Composable
private fun FilterCard(filter: Int, onFilter: (Int) -> Unit, eventCount: Int, sessionCount: Int) {
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface), shape = RoundedCornerShape(24.dp)) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            FilterChip(selected = filter == 0, onClick = { onFilter(0) }, label = { Text("All") })
            FilterChip(selected = filter == 1, onClick = { onFilter(1) }, label = { Text("Events · $eventCount") })
            FilterChip(selected = filter == 2, onClick = { onFilter(2) }, label = { Text("Study · $sessionCount") })
        }
    }
}

@Composable
private fun UpNextCard(upcoming: List<FocalRow>, onJump: (FocalRow) -> Unit) {
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface), shape = RoundedCornerShape(24.dp)) {
        Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Icon(Icons.Filled.EventAvailable, null, tint = MaterialTheme.colorScheme.primary)
                Text("Up next", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
            }
            if (upcoming.isEmpty()) {
                Text("Nothing coming up. Enjoy the clear sky.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            } else upcoming.forEach { row ->
                val data = row.data
                Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).clickable { onJump(row) }.padding(8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text(data.optString("title"), style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(timeRangeText(data), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                    Text(runCatching { FocalJson.localDate(data.getString("startTime")).format(DateTimeFormatter.ofPattern("d MMM")) }.getOrDefault(""), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
                }
            }
        }
    }
}

@Composable
private fun DayHeader(day: LocalDate, count: Int, isToday: Boolean, onToday: () -> Unit, onNew: () -> Unit, compact: Boolean = false) {
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().padding(top = if (compact) 0.dp else 4.dp)) {
        Column(Modifier.weight(1f)) {
            Text(day.format(DateTimeFormatter.ofPattern("EEEE, d MMMM")), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.ExtraBold)
            Text(if (count == 0) "Nothing scheduled" else "$count planned", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (!isToday) AssistChip(onClick = onToday, label = { Text("Today") }, leadingIcon = { Icon(Icons.Filled.Today, null, Modifier.size(AssistChipDefaults.IconSize)) })
        Spacer(Modifier.width(8.dp))
        Button(onClick = onNew) { Icon(Icons.Filled.Add, null); Text(" New event") }
    }
}

@Composable
private fun EmptyDayCard(onNew: () -> Unit) {
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.secondaryContainer), shape = RoundedCornerShape(28.dp), modifier = Modifier.fillMaxWidth().padding(top = 12.dp)) {
        Column(Modifier.padding(26.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Space to focus", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            Text("Nothing scheduled for this day. Add an event when you're ready.", style = MaterialTheme.typography.bodyMedium)
            Button(onClick = onNew, modifier = Modifier.padding(top = 8.dp)) { Icon(Icons.Filled.Add, null); Text(" Add event") }
        }
    }
}

@Composable
private fun AgendaCard(vm: FocalViewModel, row: FocalRow, onOpenEvent: (JSONObject) -> Unit, onOpenSession: (JSONObject) -> Unit) {
    val data = row.data
    val isEvent = row.entity == "events"
    val subjectId = if (isEvent) eventSubjectId(data) else sessionSubjectId(data)
    val accent = subjectColorHex(vm, subjectId) ?: if (isEvent) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.tertiary
    val done = isEvent && data.optBoolean("isFinished")
    Card(
        onClick = { if (isEvent) onOpenEvent(data) else onOpenSession(data) },
        colors = CardDefaults.cardColors(containerColor = if (done) MaterialTheme.colorScheme.surfaceVariant else MaterialTheme.colorScheme.surface),
        shape = RoundedCornerShape(24.dp), modifier = Modifier.fillMaxWidth()
    ) {
        Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            Box(Modifier.size(5.dp, 56.dp).clip(CircleShape).background(accent))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(data.optString("title").ifBlank { "Untitled" }, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis,
                    color = if (done) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface)
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Filled.AccessTime, null, Modifier.size(14.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(timeRangeText(data), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                    val typeLabel = if (isEvent) data.optString("eventType").takeIf { it.isNotBlank() }?.replaceFirstChar(Char::uppercase) ?: "Event"
                    else (data.optString("status").takeIf { it.isNotBlank() } ?: "Study")
                    AssistChip(onClick = { if (isEvent) onOpenEvent(data) else onOpenSession(data) }, label = { Text(typeLabel, style = MaterialTheme.typography.labelSmall) })
                    val subjectName = subjectId?.let { id -> vm.subjects.firstOrNull { it.id == id }?.name }
                    if (subjectName != null) Text(subjectName, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    val location = data.optString("location").takeIf { it.isNotBlank() }
                    if (location != null) Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                        Icon(Icons.Filled.LocationOn, null, Modifier.size(13.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                        Text(location, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }
            }
            if (isEvent) {
                FilledTonalButton(onClick = {
                    val copy = JSONObject(data.toString())
                    copy.put("isFinished", !done)
                    vm.saveEvent(copy, {}, {})
                }) { Icon(if (done) Icons.Filled.Check else Icons.Filled.Add, if (done) "Mark not complete" else "Mark complete") }
            } else {
                Icon(Icons.Filled.Timer, null, tint = MaterialTheme.colorScheme.tertiary)
            }
        }
    }
}

@Composable
private fun SessionDetailDialog(data: JSONObject?, onDismiss: () -> Unit) {
    if (data == null) return
    androidx.compose.material3.AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(data.optString("title").ifBlank { "Study session" }, fontWeight = FontWeight.Bold) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                val start = data.optString("startTime")
                val end = data.optString("endTime")
                Text("${data.optString("status").takeIf { it.isNotBlank() } ?: "Session"}${if (start.isNotBlank()) " · ${timeRangeText(data)}" else ""}", style = MaterialTheme.typography.bodyMedium)
                data.optString("description").takeIf { it.isNotBlank() }?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                val intervals = runCatching { data.getJSONObject("execution").getJSONArray("intervals").length() }.getOrDefault(0)
                if (intervals > 1) Text("$intervals focus intervals", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
                if (start.isNotBlank() && end.isNotBlank()) Text(FocalJson.prettyTime(start) + " → " + FocalJson.prettyTime(end) + " · " + runCatching {
                    FocalJson.localDate(start).format(DateTimeFormatter.ofPattern("d MMM yyyy"))
                }.getOrDefault(""), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        },
        confirmButton = { Button(onClick = onDismiss) { Text("Done") } }
    )
}

@Composable
private fun EventEditor(vm: FocalViewModel, initial: JSONObject?, selectedDay: LocalDate, onDismiss: () -> Unit) {
    val context = LocalContext.current
    val startInitial = remember(initial) { initial?.optString("startTime")?.takeIf { it.isNotBlank() }?.let { runCatching { FocalJson.dateTime(it) }.getOrNull() } }
    val endInitial = remember(initial) { initial?.optString("endTime")?.takeIf { it.isNotBlank() }?.let { runCatching { FocalJson.dateTime(it) }.getOrNull() } }
    var title by remember(initial) { mutableStateOf(initial?.optString("title").orEmpty()) }
    var description by remember(initial) { mutableStateOf(initial?.optString("description").orEmpty()) }
    var location by remember(initial) { mutableStateOf(initial?.optString("location").orEmpty()) }
    var type by remember(initial) { mutableStateOf(initial?.optString("eventType")?.takeIf { it.isNotBlank() } ?: "event") }
    var subject by remember(initial) { mutableStateOf(initial?.optString("subjectId")?.takeIf { it.isNotBlank() }) }
    var startDate by remember(initial) { mutableStateOf((startInitial?.toLocalDate() ?: selectedDay).toString()) }
    var startTime by remember(initial) { mutableStateOf((startInitial?.toLocalTime() ?: LocalTime.of(9, 0)).format(DateTimeFormatter.ofPattern("HH:mm"))) }
    var endDate by remember(initial) { mutableStateOf((endInitial?.toLocalDate() ?: selectedDay).toString()) }
    var endTime by remember(initial) { mutableStateOf((endInitial?.toLocalTime() ?: LocalTime.of(10, 0)).format(DateTimeFormatter.ofPattern("HH:mm"))) }
    var typeMenu by remember { mutableStateOf(false) }
    var subjectMenu by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var completed by remember(initial) { mutableStateOf(initial?.optBoolean("isFinished") ?: false) }
    var confirmDelete by remember { mutableStateOf(false) }
    fun pickDate(current: String, change: (String) -> Unit) {
        val date = LocalDate.parse(current)
        DatePickerDialog(context, { _, year, month, day -> change(LocalDate.of(year, month + 1, day).toString()) }, date.year, date.monthValue - 1, date.dayOfMonth).show()
    }
    fun pickTime(current: String, change: (String) -> Unit) {
        val time = LocalTime.parse(current)
        TimePickerDialog(context, { _, hour, minute -> change(LocalTime.of(hour, minute).format(DateTimeFormatter.ofPattern("HH:mm"))) }, time.hour, time.minute, false).show()
    }
    fun save() {
        try {
            val start = FocalJson.iso(startDate, startTime)
            val end = FocalJson.iso(endDate, endTime)
            val record = initial?.let { JSONObject(it.toString()) } ?: FocalJson.event(title, start, end, type, subject, description, location)
            if (title.trim().isBlank()) error("Give the event a title")
            if (Instant.parse(end) <= Instant.parse(start)) error("End must be after start")
            record.put("title", title.trim()).put("startTime", start).put("endTime", end).put("eventType", type)
                .put("subjectId", subject ?: JSONObject.NULL).put("location", location.trim()).put("description", description.trim())
                .put("isFinished", completed)
            busy = true
            vm.saveEvent(record, onDismiss, { busy = false })
        } catch (e: Exception) { error = e.message ?: "Check the date and time" }
    }
    Dialog(onDismissRequest = onDismiss) {
        Card(shape = RoundedCornerShape(28.dp), modifier = Modifier.widthIn(max = 680.dp).fillMaxWidth()) {
            Column(Modifier.verticalScroll(rememberScrollState()).padding(24.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(if (initial == null) "New event" else "Edit event", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.ExtraBold)
                        Text(selectedDay.format(DateTimeFormatter.ofPattern("EEEE, d MMMM")), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    IconButton(onClick = onDismiss) { Icon(Icons.Filled.Close, "Close editor") }
                }
                OutlinedTextField(title, { title = it }, label = { Text("Title") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Box { OutlinedButton(onClick = { typeMenu = true }) { Text(type.replaceFirstChar(Char::uppercase)) }; DropdownMenu(typeMenu, { typeMenu = false }) {
                        listOf("event", "homework", "sac", "practice-sac", "exam", "assignment", "other").forEach { option -> DropdownMenuItem(text = { Text(option.replaceFirstChar(Char::uppercase)) }, onClick = { type = option; typeMenu = false }) }
                    } }
                    Box { OutlinedButton(onClick = { subjectMenu = true }) { Text(vm.subjects.firstOrNull { it.id == subject }?.name ?: "Subject", maxLines = 1) }; DropdownMenu(subjectMenu, { subjectMenu = false }) {
                        DropdownMenuItem(text = { Text("None") }, onClick = { subject = null; subjectMenu = false })
                        vm.subjects.forEach { option -> DropdownMenuItem(text = { Text(option.name) }, onClick = { subject = option.id; subjectMenu = false }) }
                    } }
                }
                BoxWithConstraints(Modifier.fillMaxWidth()) {
                    // ponytail: side-by-side start/end only fits on wide dialogs; stacks on phones.
                    if (maxWidth >= 480.dp) {
                        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            DateTimeBlock("Starts", startDate, startTime, { pickDate(startDate) { startDate = it } }, { pickTime(startTime) { startTime = it } }, Modifier.weight(1f))
                            DateTimeBlock("Ends", endDate, endTime, { pickDate(endDate) { endDate = it } }, { pickTime(endTime) { endTime = it } }, Modifier.weight(1f))
                        }
                    } else {
                        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                            DateTimeBlock("Starts", startDate, startTime, { pickDate(startDate) { startDate = it } }, { pickTime(startTime) { startTime = it } })
                            DateTimeBlock("Ends", endDate, endTime, { pickDate(endDate) { endDate = it } }, { pickTime(endTime) { endTime = it } })
                        }
                    }
                }
                OutlinedTextField(location, { location = it }, label = { Text("Location") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
                OutlinedTextField(description, { description = it }, label = { Text("Notes") }, modifier = Modifier.fillMaxWidth(), minLines = 2)
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Switch(checked = completed, onCheckedChange = { completed = it })
                    Text("Completed", style = MaterialTheme.typography.bodyMedium)
                }
                if (error != null) Text(error.orEmpty(), color = MaterialTheme.colorScheme.error)
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (initial != null) OutlinedButton(onClick = { confirmDelete = true }, enabled = !busy) { Icon(Icons.Filled.Delete, null); Text(" Delete") }
                    Spacer(Modifier.weight(1f))
                    OutlinedButton(onClick = onDismiss, enabled = !busy) { Text("Cancel") }
                    Button(onClick = ::save, enabled = !busy) { Text(if (busy) "Saving…" else "Save") }
                }
            }
        }
    }
    if (confirmDelete && initial != null) androidx.compose.material3.AlertDialog(onDismissRequest = { confirmDelete = false }, title = { Text("Delete event?") },
        text = { Text("This removes it from your calendar and connected accounts.") },
        confirmButton = { Button(onClick = {
            busy = true
            vm.deleteEvent(initial.getString("id"), { confirmDelete = false; onDismiss() }, { busy = false })
        }, enabled = !busy) { Text(if (busy) "Deleting…" else "Delete") } },
        dismissButton = { OutlinedButton(onClick = { confirmDelete = false }, enabled = !busy) { Text("Keep") } })
}

@Composable
private fun DateTimeBlock(label: String, date: String, time: String, onDate: () -> Unit, onTime: () -> Unit, modifier: Modifier = Modifier) {
    Surface(color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f), shape = RoundedCornerShape(20.dp), modifier = modifier) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(label, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Bold)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = onDate) { Text(date, maxLines = 1) }
                OutlinedButton(onClick = onTime) { Text(time, maxLines = 1) }
            }
        }
    }
}

// ---------- Focus ----------

@Composable
private fun FocusScreen(vm: FocalViewModel, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val music = remember { MusicPlayer(context) }
    var attemptedMusicAccess by rememberSaveable { mutableStateOf(false) }
    val owner = LocalLifecycleOwner.current
    DisposableEffect(music, owner) {
        val observer = LifecycleEventObserver { _, event -> if (event == Lifecycle.Event.ON_RESUME) music.refresh() }
        owner.lifecycle.addObserver(observer)
        music.refresh()
        onDispose { owner.lifecycle.removeObserver(observer); music.release() }
    }
    var subject by remember { mutableStateOf<String?>(null) }
    val askNotifications = androidx.activity.compose.rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { }
    fun start() {
        if (android.os.Build.VERSION.SDK_INT >= 33 && context.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED)
            askNotifications.launch(android.Manifest.permission.POST_NOTIFICATIONS)
        vm.startTimer(subject)
    }
    val timer = vm.timer
    val seconds = timer.seconds(vm.now)
    val total = if (timer.phase == "focus") (timer.minutes * 60L).coerceAtLeast(1) else 300L
    val progress = (1f - seconds.toFloat() / total).coerceIn(0f, 1f)

    BoxWithConstraints(modifier.fillMaxSize()) {
        val wide = maxWidth >= 840.dp
        if (wide) {
            Row(Modifier.fillMaxSize().padding(horizontal = 28.dp, vertical = 24.dp), horizontalArrangement = Arrangement.spacedBy(20.dp)) {
                TimerHeroCard(vm, seconds, total, progress, subject, onSubject = { subject = it }, onStart = ::start, modifier = Modifier.weight(1.4f).fillMaxHeight(), expanded = true)
                Column(Modifier.weight(1f).fillMaxHeight().verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                    TodayStatsCard(vm)
                    MusicCard(music, attemptedMusicAccess, onEnable = {
                        attemptedMusicAccess = true
                        context.startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
                    })
                    RecentFocusCard(vm)
                }
            }
        } else {
            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                item { PageTitle("Make this hour count", "Focus", "A little structure for deeper work.") }
                item { TimerHeroCard(vm, seconds, total, progress, subject, onSubject = { subject = it }, onStart = ::start) }
                item { TodayStatsCard(vm) }
                item { MusicCard(music, attemptedMusicAccess, onEnable = {
                    attemptedMusicAccess = true
                    context.startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
                }) }
                item { RecentFocusCard(vm) }
            }
        }
    }
}

private fun formatClock(seconds: Long): String {
    val s = seconds.coerceAtLeast(0)
    return if (s >= 3600) "%d:%02d:%02d".format(s / 3600, (s % 3600) / 60, s % 60)
    else "%02d:%02d".format(s / 60, s % 60)
}

@Composable
private fun TimerHeroCard(vm: FocalViewModel, seconds: Long, total: Long, progress: Float, subject: String?, onSubject: (String?) -> Unit, onStart: () -> Unit, modifier: Modifier = Modifier, expanded: Boolean = false) {
    val timer = vm.timer
    val isBreak = timer.phase != "focus"
    val running = timer.deadline != null
    val idle = !running && timer.sessionId == null && !isBreak
    val endsAt = timer.deadline?.let { runCatching {
        Instant.ofEpochMilli(it).atZone(ZoneId.systemDefault()).format(DateTimeFormatter.ofPattern("h:mm a"))
    }.getOrNull() }
    val subjectName = subject?.let { id -> vm.subjects.firstOrNull { it.id == id }?.name }
        ?: timer.sessionId?.let { id -> vm.sessions.firstOrNull { it.id == id }?.data?.let(::sessionSubjectId)?.let { sid -> vm.subjects.firstOrNull { it.id == sid }?.name } }
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primary), shape = RoundedCornerShape(32.dp), modifier = modifier) {
        // ponytail: fill/scroll inside needs a bounded height (wide branch); in a Lazy item both measure infinite and crash.
        val scroll = rememberScrollState()
        Column((if (expanded) Modifier.fillMaxSize().verticalScroll(scroll) else Modifier.fillMaxWidth()).padding(32.dp),
            horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(18.dp, Alignment.CenterVertically)) {
            AssistChip(
                onClick = {},
                label = { Text(if (isBreak) "BREAK · 5 MIN" else "FOCUS · ${timer.minutes} MIN", fontWeight = FontWeight.ExtraBold, letterSpacing = 1.2.sp) },
                leadingIcon = { Icon(if (isBreak) Icons.Filled.Headphones else Icons.Filled.Timer, null, Modifier.size(AssistChipDefaults.IconSize)) }
            )
            Box(contentAlignment = Alignment.Center, modifier = Modifier.size(320.dp)) {
                CircularProgressIndicator(progress = { progress },
                    modifier = Modifier.fillMaxSize(), strokeWidth = 12.dp,
                    color = MaterialTheme.colorScheme.secondary, trackColor = Color.White.copy(alpha = 0.18f))
                Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(formatClock(seconds), color = MaterialTheme.colorScheme.onPrimary, fontWeight = FontWeight.ExtraBold, fontSize = 64.sp, letterSpacing = (-1).sp)
                    Text(
                        when {
                            running && endsAt != null -> "Ends $endsAt"
                            running -> "In progress"
                            timer.sessionId != null -> "Paused · resume when ready"
                            isBreak -> "Breathe · stretch · sip water"
                            else -> "Ready when you are"
                        },
                        style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onPrimary.copy(alpha = .8f)
                    )
                    if (subjectName != null) Text(subjectName, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onPrimary.copy(alpha = .9f), fontWeight = FontWeight.Bold)
                }
            }
            if (idle) {
                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf(15, 25, 50).forEach { minutes ->
                        FilterChip(selected = timer.minutes == minutes, onClick = { vm.chooseDuration(minutes) }, label = { Text("${minutes}m") })
                    }
                }
                var draft by remember(timer.minutes) { mutableStateOf(timer.minutes.toFloat()) }
                Column(Modifier.widthIn(max = 420.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Slider(value = draft, onValueChange = { draft = it }, valueRange = 5f..120f, steps = 22,
                        onValueChangeFinished = { vm.chooseDuration(draft.toInt().coerceIn(5, 120)) })
                    Text("Custom · ${draft.toInt()} min", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onPrimary.copy(alpha = .85f))
                }
                SubjectPickerRow(vm, subject, onSubject)
            } else if (!running && timer.sessionId != null) {
                Text("Paused with ${formatClock(seconds)} left", color = MaterialTheme.colorScheme.onPrimary.copy(alpha = .85f), style = MaterialTheme.typography.bodyMedium)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                if (!running) Button(onClick = onStart, enabled = !isBreak || true,
                    colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.secondary),
                    contentPadding = PaddingValues(horizontal = 28.dp, vertical = 16.dp)) {
                    Icon(Icons.Filled.PlayArrow, null); Text(if (timer.sessionId == null && !isBreak) " Start focus" else " Resume", style = MaterialTheme.typography.titleMedium)
                }
                else Button(onClick = vm::pauseTimer,
                    colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.secondary),
                    contentPadding = PaddingValues(horizontal = 28.dp, vertical = 16.dp)) {
                    Icon(Icons.Filled.Pause, null); Text(" Pause", style = MaterialTheme.typography.titleMedium)
                }
                if (timer.sessionId != null || isBreak) OutlinedButton(
                    onClick = vm::finishTimer,
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.onPrimary),
                    contentPadding = PaddingValues(horizontal = 20.dp, vertical = 16.dp)) {
                    Text(if (isBreak) "Skip break" else "Finish", style = MaterialTheme.typography.titleMedium)
                }
            }
            if (isBreak) Text("Finishing the break resets the timer for your next block.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onPrimary.copy(alpha = .7f), textAlign = TextAlign.Center)
        }
    }
}

@Composable
private fun SubjectPickerRow(vm: FocalViewModel, selected: String?, onSubject: (String?) -> Unit) {
    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("Subject", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onPrimary.copy(alpha = .85f), fontWeight = FontWeight.Bold)
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            FilterChip(selected = selected == null, onClick = { onSubject(null) }, label = { Text("None") })
            vm.subjects.forEach { option ->
                FilterChip(selected = selected == option.id, onClick = { onSubject(option.id) },
                    label = { Text(option.name) },
                    leadingIcon = { Box(Modifier.size(10.dp).background(Color((option.color and 0xffffffffL).toInt()), CircleShape)) })
            }
        }
    }
}

@Composable
private fun TodayStatsCard(vm: FocalViewModel) {
    val today = LocalDate.now()
    val todays = remember(vm.sessions) { vm.sessions.filter { eventOnDay(it, today) } }
    val minutes = remember(todays) {
        todays.sumOf { row ->
            runCatching {
                Duration.between(Instant.parse(row.data.getString("startTime")), Instant.parse(row.data.optString("endTime").takeIf { it.isNotBlank() } ?: row.data.getString("startTime"))).toMinutes()
            }.getOrDefault(0)
        }.coerceAtLeast(0)
    }
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface), shape = RoundedCornerShape(24.dp)) {
        Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("Today", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                StatTile("${minutes}m", "focused", Modifier.weight(1f))
                StatTile("${todays.size}", "sessions", Modifier.weight(1f))
                StatTile("${vm.sessions.size}", "total", Modifier.weight(1f))
            }
        }
    }
}

@Composable
private fun StatTile(value: String, label: String, modifier: Modifier = Modifier) {
    Surface(color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.55f), shape = RoundedCornerShape(18.dp), modifier = modifier) {
        Column(Modifier.padding(vertical = 14.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Text(value, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.ExtraBold)
            Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun MusicCard(music: MusicPlayer, attemptedAccess: Boolean, onEnable: () -> Unit) {
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow), shape = RoundedCornerShape(24.dp)) {
        Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Icon(Icons.Filled.Headphones, null, tint = MaterialTheme.colorScheme.primary)
                Text("Music", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                if (music.accessGranted) IconButton(onClick = music::refresh) { Icon(Icons.Filled.Refresh, "Refresh music player") }
            }
            if (!music.accessGranted) {
                Text("Control Spotify or Apple Music without leaving your timer. Allow notification access once.", style = MaterialTheme.typography.bodyMedium)
                Button(onClick = onEnable) { Text("Enable music controls") }
                if (attemptedAccess && android.os.Build.VERSION.SDK_INT >= 33)
                    Text("If Android blocks access for this APK, open Focal in App info, tap More, then Allow restricted settings.", style = MaterialTheme.typography.bodySmall)
            } else {
                if (music.sources.size > 1) {
                    var playerMenu by remember { mutableStateOf(false) }
                    Box {
                        AssistChip(onClick = { playerMenu = true }, label = { Text(music.sources[music.selectedIndex]) })
                        DropdownMenu(playerMenu, { playerMenu = false }) {
                            music.sources.forEachIndexed { index, label ->
                                DropdownMenuItem(text = { Text(label) }, onClick = { music.select(index); playerMenu = false })
                            }
                        }
                    }
                } else if (music.sources.isNotEmpty()) Text(music.sources.first(), style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary)
                Text(music.title.ifBlank { "No track detected" }, style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (music.artist.isNotBlank()) Text(music.artist, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (music.sources.isEmpty()) Text("Open your music app and start a track, then return here.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    IconButton(onClick = music::previous, enabled = music.canPrevious) { Icon(Icons.Filled.SkipPrevious, "Previous track") }
                    FilledIconButton(onClick = music::toggle, enabled = music.canToggle) { Icon(if (music.playing) Icons.Filled.Pause else Icons.Filled.PlayArrow, if (music.playing) "Pause music" else "Play music") }
                    IconButton(onClick = music::next, enabled = music.canNext) { Icon(Icons.Filled.SkipNext, "Next track") }
                }
            }
            music.error?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error) }
        }
    }
}

@Composable
private fun RecentFocusCard(vm: FocalViewModel) {
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface), shape = RoundedCornerShape(24.dp)) {
        Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("Recent focus", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            if (vm.sessions.isEmpty()) {
                Text("Finish a focus session to see it here.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            } else vm.sessions.takeLast(6).reversed().forEach { session ->
                val data = session.data
                val sid = sessionSubjectId(data)
                val accent = subjectColorHex(vm, sid) ?: MaterialTheme.colorScheme.tertiary
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Box(Modifier.size(10.dp).background(accent, CircleShape))
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text(data.optString("title").ifBlank { "Focus session" }, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text("${data.optString("status").takeIf { it.isNotBlank() } ?: "session"} · ${runCatching { FocalJson.localDate(data.getString("startTime")).format(DateTimeFormatter.ofPattern("d MMM")) }.getOrDefault("")}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    val dur = runCatching { durationText(data.getString("startTime"), data.optString("endTime").takeIf { it.isNotBlank() } ?: data.getString("startTime")) }.getOrDefault("")
                    if (dur.isNotBlank()) Text(dur, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary)
                }
                if (session != vm.sessions.takeLast(6).reversed().last()) HorizontalDivider(color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.6f))
            }
        }
    }
}

@Composable
private fun AccountScreen(vm: FocalViewModel, modifier: Modifier = Modifier) {
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var notionToken by remember { mutableStateOf("") }
    var notionDatabase by remember(vm.account) { mutableStateOf(vm.notionSettings().database) }
    var titleProperty by remember(vm.account) { mutableStateOf(vm.notionSettings().title) }
    var dateProperty by remember(vm.account) { mutableStateOf(vm.notionSettings().date) }
    var typeProperty by remember(vm.account) { mutableStateOf(vm.notionSettings().type) }
    var completedProperty by remember(vm.account) { mutableStateOf(vm.notionSettings().completed) }
    var subjectProperty by remember(vm.account) { mutableStateOf(vm.notionSettings().subject) }
    var showMapping by remember { mutableStateOf(false) }
    BoxWithConstraints(modifier.fillMaxSize()) {
        val wide = maxWidth >= 840.dp
        val contentModifier = if (wide) Modifier.widthIn(max = 760.dp).fillMaxWidth() else Modifier.fillMaxWidth()
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
            LazyColumn(contentModifier, contentPadding = PaddingValues(24.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
                item { PageTitle("Stay in sync", "Account", "Your plans and study time, wherever you work.") }
                item {
                    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer)) {
                        Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                            Text("Focal account", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                            if (!vm.configured) Text("Add your Focal Supabase URL and publishable key to local.properties, then rebuild.")
                            else if (vm.account == "guest") {
                                Text("Guest plans stay on this device until you sign in.", style = MaterialTheme.typography.bodyMedium)
                                OutlinedTextField(email, { email = it }, label = { Text("Email") }, singleLine = true, modifier = Modifier.fillMaxWidth(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email))
                                OutlinedTextField(password, { password = it }, label = { Text("Password") }, singleLine = true, modifier = Modifier.fillMaxWidth(),
                                    visualTransformation = androidx.compose.ui.text.input.PasswordVisualTransformation(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password))
                                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                    Button(onClick = { vm.signIn(email, password) }, enabled = !vm.accountBusy, modifier = Modifier.fillMaxWidth()) { Text(if (vm.accountBusy) "Working…" else "Sign in") }
                                    OutlinedButton(onClick = { vm.signUp(email, password) }, enabled = !vm.accountBusy, modifier = Modifier.fillMaxWidth()) { Text("Create account") }
                                }
                            } else {
                                Text(vm.email ?: "Signed in · ${vm.account.take(8)}…", style = MaterialTheme.typography.bodyMedium)
                                Text(vm.syncStatus, color = MaterialTheme.colorScheme.onPrimaryContainer)
                                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                    FilledTonalButton(onClick = vm::syncNow, modifier = Modifier.fillMaxWidth()) { Icon(Icons.Filled.Refresh, null); Text(" Sync now") }
                                    OutlinedButton(onClick = vm::signOut, enabled = !vm.accountBusy, modifier = Modifier.fillMaxWidth()) { Text("Sign out") }
                                }
                            }
                        }
                    }
                }
                item {
                    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow)) {
                        Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                            Text("Notion calendar", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                            Text("Two-way sync with the same database and Focal ID fields used by desktop.", style = MaterialTheme.typography.bodyMedium)
                            OutlinedTextField(notionToken, { notionToken = it }, label = { Text(if (vm.hasNotionToken()) "Integration token saved · enter to replace" else "Integration token") },
                                modifier = Modifier.fillMaxWidth(), visualTransformation = androidx.compose.ui.text.input.PasswordVisualTransformation())
                            OutlinedTextField(notionDatabase, { notionDatabase = it }, label = { Text("Database ID") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
                            OutlinedButton(onClick = { showMapping = !showMapping }) { Text(if (showMapping) "Hide property mapping" else "Property mapping") }
                            if (showMapping) {
                                OutlinedTextField(titleProperty, { titleProperty = it }, label = { Text("Title property") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
                                OutlinedTextField(dateProperty, { dateProperty = it }, label = { Text("Date property") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
                                OutlinedTextField(typeProperty, { typeProperty = it }, label = { Text("Type property") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
                                OutlinedTextField(completedProperty, { completedProperty = it }, label = { Text("Complete property") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
                                OutlinedTextField(subjectProperty, { subjectProperty = it }, label = { Text("Subject property") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
                            }
                            Button(onClick = { vm.saveNotion(notionToken, NotionSettings(notionDatabase, titleProperty, dateProperty, typeProperty, completedProperty, subjectProperty)) }, modifier = Modifier.fillMaxWidth()) { Text("Save and sync") }
                        }
                    }
                }
                item {
                    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow)) {
                        Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                            Text("App updates", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                            Text("Version ${BuildConfig.VERSION_NAME} · GitHub Releases", style = MaterialTheme.typography.bodyMedium)
                            vm.availableUpdate?.let { Text("Version ${it.version} is ready", color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.Bold) }
                            if (vm.updateStatus.isNotBlank()) Text(vm.updateStatus, style = MaterialTheme.typography.bodySmall)
                            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                OutlinedButton(onClick = vm::checkUpdates, enabled = !vm.updateBusy, modifier = Modifier.fillMaxWidth()) { Text("Check updates") }
                                if (vm.availableUpdate != null) Button(onClick = vm::installUpdate, enabled = !vm.updateBusy, modifier = Modifier.fillMaxWidth()) { Text("Install update") }
                            }
                        }
                    }
                }
                if (vm.cloudConflicts.isNotEmpty() || vm.notionConflicts.isNotEmpty()) item { Text("Changes to review", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold) }
                items(vm.cloudConflicts) { conflict -> ConflictCard("Focal account", conflict, { vm.resolveCloud(conflict, true) }, { vm.resolveCloud(conflict, false) }) }
                items(vm.notionConflicts) { conflict -> ConflictCard("Notion", conflict, { vm.resolveNotion(conflict, true) }, { vm.resolveNotion(conflict, false) }) }
                item { Text("Notion tokens stay on this device. Account data sync uses your own Focal login.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            }
        }
    }
}

@Composable
private fun ConflictCard(source: String, conflict: MergeConflict, keepLocal: () -> Unit, useRemote: () -> Unit) {
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer)) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("$source · ${conflict.entity.replace('_', ' ')}", fontWeight = FontWeight.Bold)
            Text(conflict.remote?.optString("title")?.takeIf { it.isNotBlank() } ?: conflict.rowId, style = MaterialTheme.typography.bodyMedium)
            Text("This item changed in two places. Choose the version to keep.", style = MaterialTheme.typography.bodySmall)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = keepLocal) { Text("Keep this device") }
                Button(onClick = useRemote) { Text("Use $source") }
            }
        }
    }
}
