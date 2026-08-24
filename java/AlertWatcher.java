import java.awt.GraphicsEnvironment;
import java.io.IOException;
import java.nio.channels.FileChannel;
import java.nio.channels.FileLock;
import java.nio.channels.OverlappingFileLockException;
import java.nio.charset.StandardCharsets;
import java.nio.file.FileSystems;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.nio.file.WatchEvent;
import java.nio.file.WatchKey;
import java.nio.file.WatchService;
import java.util.Comparator;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import javax.swing.JOptionPane;
import javax.swing.SwingUtilities;

public final class AlertWatcher {
  private static final String DEFAULT_ALERT_DIR = "C:\\Impresiones\\Alertas";
  private static final Pattern LOG_FOLDER = Pattern.compile("\\\"logFolder\\\"\\s*:\\s*\\\"([^\\\"]*)\\\"");

  private AlertWatcher() {}

  public static void main(String[] args) {
    if (GraphicsEnvironment.isHeadless()) {
      log("No se puede mostrar alertas en una sesión sin escritorio.");
      return;
    }

    Path appDir = args.length > 0 ? Path.of(args[0]) : Path.of(System.getProperty("user.dir"));
    Path alertDir = resolveAlertDir(appDir.resolve("config.json"));
    try (FileChannel lockChannel = FileChannel.open(alertDir.resolve(".watcher.lock"),
        StandardOpenOption.CREATE, StandardOpenOption.WRITE)) {
      FileLock lock = lockChannel.tryLock();
      if (lock == null) return;
      try {
        watch(alertDir);
      } finally {
        lock.release();
      }
    } catch (OverlappingFileLockException ignored) {
      // Otra instancia del watcher ya está activa en esta sesión.
    } catch (IOException exception) {
      log("No se pudo iniciar el vigilante: " + exception.getMessage());
    }
  }

  private static Path resolveAlertDir(Path configPath) {
    try {
      String config = Files.readString(configPath, StandardCharsets.UTF_8);
      Matcher matcher = LOG_FOLDER.matcher(config);
      if (matcher.find()) {
        Path logDir = Path.of(matcher.group(1).replace("\\\\", "\\"));
        Path parent = logDir.getParent();
        if (parent != null) return parent.resolve("Alertas");
      }
    } catch (IOException | RuntimeException ignored) {
      // Se usa la ruta estándar si config.json no está disponible o es inválido.
    }
    return Path.of(DEFAULT_ALERT_DIR);
  }

  private static void watch(Path alertDir) throws IOException {
    Files.createDirectories(alertDir);
    processPending(alertDir);

    try (WatchService watchService = FileSystems.getDefault().newWatchService()) {
      alertDir.register(watchService, java.nio.file.StandardWatchEventKinds.ENTRY_CREATE);
      while (true) {
        WatchKey key = watchService.take();
        for (WatchEvent<?> event : key.pollEvents()) {
          if (event.kind() == java.nio.file.StandardWatchEventKinds.OVERFLOW) continue;
          Path file = alertDir.resolve((Path) event.context());
          if (file.getFileName().toString().toLowerCase().endsWith(".txt")) processAlert(file);
        }
        if (!key.reset()) return;
      }
    } catch (InterruptedException exception) {
      Thread.currentThread().interrupt();
    }
  }

  private static void processPending(Path alertDir) throws IOException {
    try (var files = Files.list(alertDir)) {
      files.filter(file -> file.getFileName().toString().toLowerCase().endsWith(".txt"))
          .sorted(Comparator.comparing(Path::toString))
          .forEach(AlertWatcher::processAlert);
    }
  }

  private static void processAlert(Path file) {
    try {
      String content = Files.readString(file, StandardCharsets.UTF_8).trim();
      if (content.isEmpty()) return;

      String[] titleAndBody = content.split("\\R\\R", 2);
      String title = titleAndBody[0].trim();
      String body = titleAndBody.length > 1 ? titleAndBody[1].trim() : content;
      int messageType = content.contains("[ERROR]") ? JOptionPane.ERROR_MESSAGE
          : content.contains("[AVISO]") ? JOptionPane.WARNING_MESSAGE
          : JOptionPane.INFORMATION_MESSAGE;

      SwingUtilities.invokeLater(() -> {
        try {
          JOptionPane.showMessageDialog(null, body, title, messageType);
        } finally {
          deleteAlert(file);
        }
      });
    } catch (IOException exception) {
      log("No se pudo leer " + file.getFileName() + ": " + exception.getMessage());
    }
  }

  private static void deleteAlert(Path file) {
    try {
      Files.deleteIfExists(file);
    } catch (IOException exception) {
      log("No se pudo eliminar " + file.getFileName() + ": " + exception.getMessage());
    }
  }

  private static void log(String message) {
    System.err.println("[CBSAlertWatcher] " + message);
  }
}
