import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:provider/provider.dart';
import 'package:firebase_core/firebase_core.dart';
import 'services/analyze_service.dart';
import 'screens/login_screen.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // await Firebase.initializeApp(); // Uncomment after adding google-services.json
  runApp(const RePassApp());
}

class RePassApp extends StatelessWidget {
  const RePassApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        Provider<AnalyzeService>(
          create: (_) => AnalyzeService(baseUrl: 'http://localhost:5173'), // Placeholder
        ),
      ],
      child: MaterialApp(
        title: 'Re-Pass',
        debugShowCheckedModeBanner: false,
        theme: ThemeData(
          useMaterial3: true,
          colorScheme: ColorScheme.fromSeed(
            seedColor: const Color(0xFF4F46E5), // Indigo 600
            primary: const Color(0xFF4F46E5),
            secondary: const Color(0xFFEC4899), // Pink 500
            background: const Color(0xFFF9FAFB),
          ),
          textTheme: GoogleFonts.notoSansJpTextTheme(
            Theme.of(context).textTheme,
          ),
          appBarTheme: AppBarTheme(
            backgroundColor: Colors.white.withOpacity(0.7),
            elevation: 0,
            centerTitle: true,
            titleTextStyle: GoogleFonts.outfit(
              textStyle: const TextStyle(
                color: Color(0xFF1E293B),
                fontSize: 20,
                fontWeight: FontWeight.bold,
              ),
            ),
          ),
        ),
        home: const LoginScreen(),
      ),
    );
  }
}
