package com.andy.focal

import android.app.DatePickerDialog
import android.app.TimePickerDialog
import android.os.Bundle
import android.provider.OpenableColumns
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.ArrowForward
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Headphones
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.SkipNext
import androidx.compose.material.icons.filled.SkipPrevious
import androidx.compose.material.icons.filled.Timer
import androidx.compose.material.icons.filled.Tune
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
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
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import org.json.JSONObject
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.YearMonth
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
    val context = LocalContext.current
    val dark = androidx.compose.foundation.isSystemInDarkTheme()
    val colors = if (android.os.Build.VERSION.SDK_INT >= 31) {
        if (dark) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
    } else if (dark) darkColorScheme(primary = Color(0xFFAEC6FF), secondary = Color(0xFFC4C6D0))
    else lightColorScheme(primary = Color(0xFF254A82), secondary = Color(0xFF4C6289))
    MaterialTheme(colorScheme = colors, shapes = MaterialTheme.shapes.copy(large = RoundedCornerShape(28.dp), extraLarge = RoundedCornerShape(32.dp))) {
        var tab by remember { mutableStateOf(0) }
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
        Scaffold(
            snackbarHost = { SnackbarHost(snackbar) },
            bottomBar = {
                NavigationBar {
                    listOf(Triple("Plan", Icons.Filled.CalendarMonth, 0), Triple("Focus", Icons.Filled.Timer, 1), Triple("Account", Icons.Filled.Tune, 2)).forEach { (label, icon, index) ->
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

@Composable
private fun PageTitle(kicker: String, title: String, subtitle: String) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(kicker.uppercase(), style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.Bold)
        Text(title, style = MaterialTheme.typography.displaySmall, fontWeight = FontWeight.ExtraBold)
        Text(subtitle, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

private fun eventOnDay(row: FocalRow, day: LocalDate): Boolean = runCatching {
    val start = FocalJson.localDate(row.data.getString("startTime"))
    val end = row.data.optString("endTime").takeIf { it.isNotBlank() }?.let(FocalJson::localDate) ?: start
    !start.isAfter(day) && !end.isBefore(day)
}.getOrDefault(false)

@Composable
private fun CalendarScreen(vm: FocalViewModel, modifier: Modifier = Modifier) {
    var month by remember { mutableStateOf(YearMonth.now()) }
    var day by remember { mutableStateOf(LocalDate.now()) }
    var editor by remember { mutableStateOf<JSONObject?>(null) }
    var create by remember { mutableStateOf(false) }
    var selectedSession by remember { mutableStateOf<JSONObject?>(null) }
    val entries = (vm.events + vm.sessions).filter { eventOnDay(it, day) }.sortedBy { it.data.optString("startTime") }
    Box(modifier.fillMaxSize()) {
        LazyColumn(contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = 26.dp, bottom = 100.dp), verticalArrangement = Arrangement.spacedBy(22.dp)) {
            item { PageTitle("Make room for what matters", "Your plan", "A clear view of the days ahead.") }
            item {
                Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow)) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                            Text(month.format(DateTimeFormatter.ofPattern("MMMM yyyy")), modifier = Modifier.weight(1f), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                            IconButton(onClick = { month = month.minusMonths(1) }) { Icon(Icons.Filled.ArrowBack, "Previous month") }
                            IconButton(onClick = { month = month.plusMonths(1) }) { Icon(Icons.Filled.ArrowForward, "Next month") }
                        }
                        Row { listOf("M", "T", "W", "T", "F", "S", "S").forEach { Text(it, Modifier.weight(1f), textAlign = androidx.compose.ui.text.style.TextAlign.Center, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant) } }
                        val firstOffset = month.atDay(1).dayOfWeek.value - 1
                        val slots = firstOffset + month.lengthOfMonth()
                        repeat((slots + 6) / 7) { week ->
                            Row(horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                                repeat(7) { weekday ->
                                    val number = week * 7 + weekday - firstOffset + 1
                                    if (number in 1..month.lengthOfMonth()) {
                                        val date = month.atDay(number)
                                        val hasEntry = (vm.events + vm.sessions).any { eventOnDay(it, date) }
                                        val selected = date == day
                                        Column(Modifier.weight(1f).aspectRatio(0.95f).clip(RoundedCornerShape(16.dp))
                                            .background(if (selected) MaterialTheme.colorScheme.primary else Color.Transparent)
                                            .clickable { day = date }, horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                                            Text(number.toString(), color = if (selected) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurface,
                                                style = MaterialTheme.typography.bodyLarge, fontWeight = if (selected || date == LocalDate.now()) FontWeight.Bold else FontWeight.Normal)
                                            if (hasEntry) Box(Modifier.padding(top = 3.dp).size(4.dp).background(if (selected) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.primary, CircleShape))
                                        }
                                    } else Spacer(Modifier.weight(1f))
                                }
                            }
                        }
                    }
                }
            }
            item {
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                    Column(Modifier.weight(1f)) {
                        Text(day.format(DateTimeFormatter.ofPattern("EEEE, d MMMM")), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                        Text("${entries.size} planned", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    AssistChip(onClick = { month = YearMonth.now(); day = LocalDate.now() }, label = { Text("Today") })
                }
            }
            if (entries.isEmpty()) item {
                Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.secondaryContainer)) {
                    Column(Modifier.padding(22.dp)) {
                        Text("Space to focus", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                        Text("Nothing scheduled for this day. Add an event when you’re ready.", style = MaterialTheme.typography.bodyMedium)
                    }
                }
            }
            items(entries, key = { it.entity + it.id }) { row ->
                val data = row.data
                Card(onClick = { if (row.entity == "events") editor = data else selectedSession = data },
                    colors = CardDefaults.cardColors(containerColor = if (row.entity == "events") MaterialTheme.colorScheme.surfaceContainer else MaterialTheme.colorScheme.tertiaryContainer)) {
                    Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                        Box(Modifier.size(5.dp, 46.dp).clip(CircleShape).background(if (row.entity == "events") MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.tertiary))
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                            Text(data.optString("title"), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text("${FocalJson.prettyTime(data.optString("startTime"))} · ${if (row.entity == "events") data.optString("eventType").replaceFirstChar(Char::uppercase) else "Study session"}", style = MaterialTheme.typography.bodySmall)
                        }
                        if (row.entity == "events" && data.optBoolean("isFinished")) Icon(Icons.Filled.Check, "Complete", tint = MaterialTheme.colorScheme.primary)
                    }
                }
            }
        }
        ExtendedFloatingActionButton(onClick = { create = true }, icon = { Icon(Icons.Filled.Add, null) }, text = { Text("New event") },
            modifier = Modifier.align(Alignment.BottomEnd).padding(20.dp))
    }
    if (create || editor != null) EventEditor(vm, editor, day, onDismiss = { create = false; editor = null })
    if (selectedSession != null) AlertDialog(onDismissRequest = { selectedSession = null }, title = { Text(selectedSession?.optString("title").orEmpty()) },
        text = { Text("${selectedSession?.optString("status")} · ${selectedSession?.optString("startTime")?.let(FocalJson::prettyTime)}") },
        confirmButton = { Button(onClick = { selectedSession = null }) { Text("Done") } })
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
    var confirmDelete by remember { mutableStateOf(false) }
    fun pickDate(current: String, change: (String) -> Unit) {
        val date = LocalDate.parse(current)
        DatePickerDialog(context, { _, year, month, day -> change(LocalDate.of(year, month + 1, day).toString()) }, date.year, date.monthValue - 1, date.dayOfMonth).show()
    }
    fun pickTime(current: String, change: (String) -> Unit) {
        val time = LocalTime.parse(current)
        TimePickerDialog(context, { _, hour, minute -> change(LocalTime.of(hour, minute).format(DateTimeFormatter.ofPattern("HH:mm"))) }, time.hour, time.minute, false).show()
    }
    AlertDialog(onDismissRequest = onDismiss, title = { Text(if (initial == null) "New event" else "Edit event", fontWeight = FontWeight.Bold) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedTextField(title, { title = it }, label = { Text("Title") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Box { OutlinedButton(onClick = { typeMenu = true }) { Text(type.replaceFirstChar(Char::uppercase)) }; DropdownMenu(typeMenu, { typeMenu = false }) {
                        listOf("event", "homework", "sac", "practice-sac", "exam", "assignment", "other").forEach { option -> DropdownMenuItem(text = { Text(option.replaceFirstChar(Char::uppercase)) }, onClick = { type = option; typeMenu = false }) }
                    } }
                    Box { OutlinedButton(onClick = { subjectMenu = true }) { Text(vm.subjects.firstOrNull { it.id == subject }?.name ?: "Subject") }; DropdownMenu(subjectMenu, { subjectMenu = false }) {
                        DropdownMenuItem(text = { Text("None") }, onClick = { subject = null; subjectMenu = false })
                        vm.subjects.forEach { option -> DropdownMenuItem(text = { Text(option.name) }, onClick = { subject = option.id; subjectMenu = false }) }
                    } }
                }
                Text("Starts", style = MaterialTheme.typography.labelLarge)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = { pickDate(startDate) { startDate = it } }) { Text(startDate) }
                    OutlinedButton(onClick = { pickTime(startTime) { startTime = it } }) { Text(startTime) }
                }
                Text("Ends", style = MaterialTheme.typography.labelLarge)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = { pickDate(endDate) { endDate = it } }) { Text(endDate) }
                    OutlinedButton(onClick = { pickTime(endTime) { endTime = it } }) { Text(endTime) }
                }
                OutlinedTextField(location, { location = it }, label = { Text("Location") }, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(description, { description = it }, label = { Text("Notes") }, modifier = Modifier.fillMaxWidth(), minLines = 2)
                if (error != null) Text(error.orEmpty(), color = MaterialTheme.colorScheme.error)
                if (initial != null) OutlinedButton(onClick = { confirmDelete = true }) { Icon(Icons.Filled.Delete, null); Text(" Delete event") }
            }
        },
        confirmButton = { Button(onClick = {
            try {
                val start = FocalJson.iso(startDate, startTime)
                val end = FocalJson.iso(endDate, endTime)
                val record = initial?.let { JSONObject(it.toString()) } ?: FocalJson.event(title, start, end, type, subject, description, location)
                if (title.trim().isBlank()) error("Give the event a title")
                if (Instant.parse(end) <= Instant.parse(start)) error("End must be after start")
                record.put("title", title.trim()).put("startTime", start).put("endTime", end).put("eventType", type)
                    .put("subjectId", subject ?: JSONObject.NULL).put("location", location.trim()).put("description", description.trim())
                vm.saveEvent(record); onDismiss()
            } catch (e: Exception) { error = e.message ?: "Check the date and time" }
        }) { Text("Save") } },
        dismissButton = { OutlinedButton(onClick = onDismiss) { Text("Cancel") } })
    if (confirmDelete && initial != null) AlertDialog(onDismissRequest = { confirmDelete = false }, title = { Text("Delete event?") },
        text = { Text("This removes it from your calendar and connected accounts.") },
        confirmButton = { Button(onClick = { vm.deleteEvent(initial.getString("id")); confirmDelete = false; onDismiss() }) { Text("Delete") } },
        dismissButton = { OutlinedButton(onClick = { confirmDelete = false }) { Text("Keep") } })
}

@Composable
private fun FocusScreen(vm: FocalViewModel, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val music = remember { MusicPlayer(context) }
    DisposableEffect(music) { onDispose { music.release() } }
    val pickAudio = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) {
            runCatching { context.contentResolver.takePersistableUriPermission(uri, android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION) }
            val name = context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c -> if (c.moveToFirst()) c.getString(0) else null } ?: "Audio"
            music.load(uri, name)
        }
    }
    var subject by remember { mutableStateOf<String?>(null) }
    val askNotifications = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { }
    fun start() {
        if (android.os.Build.VERSION.SDK_INT >= 33 && context.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED)
            askNotifications.launch(android.Manifest.permission.POST_NOTIFICATIONS)
        vm.startTimer(subject)
    }
    var menu by remember { mutableStateOf(false) }
    val timer = vm.timer
    val seconds = timer.seconds(vm.now)
    val time = "%02d:%02d".format(seconds / 60, seconds % 60)
    LazyColumn(modifier.fillMaxSize(), contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(22.dp)) {
        item { PageTitle("Make this hour count", "Focus", "A little structure for deeper work.") }
        item {
            Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer), shape = RoundedCornerShape(32.dp)) {
                Column(Modifier.fillMaxWidth().padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(18.dp)) {
                    Text(if (timer.phase == "focus") "FOCUS SESSION" else "TAKE A BREATH", style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onPrimaryContainer)
                    Box(Modifier.size(244.dp), contentAlignment = Alignment.Center) {
                        CircularProgressIndicator(progress = { if (timer.phase == "focus") 1f - seconds.toFloat() / (timer.minutes * 60) else 1f - seconds.toFloat() / 300f },
                            modifier = Modifier.fillMaxSize(), strokeWidth = 12.dp, trackColor = MaterialTheme.colorScheme.surfaceContainerHigh)
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Text(time, style = MaterialTheme.typography.displayLarge, fontWeight = FontWeight.ExtraBold)
                            Text(if (timer.deadline != null) "In progress" else "Ready when you are", style = MaterialTheme.typography.bodyMedium)
                        }
                    }
                    if (timer.sessionId == null && timer.phase == "focus") {
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            listOf(15, 25, 50).forEach { minutes -> FilterChip(selected = timer.minutes == minutes, onClick = { vm.chooseDuration(minutes) }, label = { Text("${minutes}m") }) }
                        }
                        Box { OutlinedButton(onClick = { menu = true }) { Text(vm.subjects.firstOrNull { it.id == subject }?.name ?: "Choose subject") }; DropdownMenu(menu, { menu = false }) {
                            DropdownMenuItem(text = { Text("No subject") }, onClick = { subject = null; menu = false })
                            vm.subjects.forEach { option -> DropdownMenuItem(text = { Text(option.name) }, onClick = { subject = option.id; menu = false }) }
                        } }
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                        if (timer.deadline == null) Button(onClick = ::start) { Icon(Icons.Filled.PlayArrow, null); Text(if (timer.sessionId == null) " Start focus" else " Resume") }
                        else Button(onClick = vm::pauseTimer) { Icon(Icons.Filled.Pause, null); Text(" Pause") }
                        if (timer.sessionId != null || timer.phase == "break") OutlinedButton(onClick = vm::finishTimer) { Text(if (timer.phase == "break") "Skip break" else "Finish") }
                    }
                }
            }
        }
        item {
            Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow)) {
                Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Icon(Icons.Filled.Headphones, null, tint = MaterialTheme.colorScheme.primary)
                        Text("Your music", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                    }
                    Text(music.title, style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                        IconButton(onClick = { music.seek(-10_000) }, enabled = music.ready) { Icon(Icons.Filled.SkipPrevious, "Back ten seconds") }
                        FilledIconButton(onClick = music::toggle, enabled = music.ready) { Icon(if (music.playing) Icons.Filled.Pause else Icons.Filled.PlayArrow, if (music.playing) "Pause music" else "Play music") }
                        IconButton(onClick = { music.seek(10_000) }, enabled = music.ready) { Icon(Icons.Filled.SkipNext, "Forward ten seconds") }
                        OutlinedButton(onClick = { pickAudio.launch(arrayOf("audio/*")) }) { Text("Choose audio") }
                    }
                }
            }
        }
        item {
            Text("Recent focus", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
        }
        items(vm.sessions.takeLast(5).reversed()) { session ->
            val data = session.data
            Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer)) {
                Column(Modifier.padding(16.dp)) {
                    Text(data.optString("title"), fontWeight = FontWeight.Bold)
                    Text("${data.optString("status")} · ${data.optString("startTime").take(10)}", style = MaterialTheme.typography.bodySmall)
                }
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
    LazyColumn(modifier.fillMaxSize(), contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
        item { PageTitle("Stay in sync", "Account", "Your plans and study time, wherever you work.") }
        item {
            Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer)) {
                Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text("Focal account", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                    if (!vm.configured) Text("Add your Focal Supabase URL and publishable key to local.properties, then rebuild.")
                    else if (vm.account == "guest") {
                        OutlinedTextField(email, { email = it }, label = { Text("Email") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                        OutlinedTextField(password, { password = it }, label = { Text("Password") }, singleLine = true, modifier = Modifier.fillMaxWidth(),
                            visualTransformation = androidx.compose.ui.text.input.PasswordVisualTransformation())
                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            Button(onClick = { vm.signIn(email, password) }) { Text("Sign in") }
                            OutlinedButton(onClick = { vm.signUp(email, password) }) { Text("Create account") }
                        }
                    } else {
                        Text(vm.email ?: "Signed in · ${vm.account.take(8)}…", style = MaterialTheme.typography.bodyMedium)
                        Text(vm.syncStatus, color = MaterialTheme.colorScheme.onPrimaryContainer)
                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            FilledTonalButton(onClick = vm::syncNow) { Icon(Icons.Filled.Refresh, null); Text(" Sync now") }
                            OutlinedButton(onClick = vm::signOut) { Text("Sign out") }
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
                    Button(onClick = { vm.saveNotion(notionToken, NotionSettings(notionDatabase, titleProperty, dateProperty, typeProperty, completedProperty, subjectProperty)); notionToken = "" }) { Text("Save and sync") }
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
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        OutlinedButton(onClick = vm::checkUpdates, enabled = !vm.updateBusy) { Text("Check updates") }
                        if (vm.availableUpdate != null) Button(onClick = vm::installUpdate, enabled = !vm.updateBusy) { Text("Install update") }
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
