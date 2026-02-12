import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:firebase_auth/firebase_auth.dart';

class AnalyzeService {
  final String baseUrl;

  AnalyzeService({required this.baseUrl});

  Future<Map<String, dynamic>> analyze({
    required String text,
    required String mode,
    required int targetLength,
    String? pdfUrl,
    String? imageUrl,
  }) async {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null) {
      throw Exception('User not authenticated');
    }

    final token = await user.getIdToken();
    final response = await http.post(
      Uri.parse('$baseUrl/api/analyze'),
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer $token',
      },
      body: jsonEncode({
        'text': text,
        'mode': mode,
        'targetLength': targetLength,
        if (pdfUrl != null) 'pdfUrl': pdfUrl,
        if (imageUrl != null) 'imageUrl': imageUrl,
      }),
    );

    if (response.statusCode == 200) {
      return jsonDecode(utf8.decode(response.bodyBytes));
    } else {
      final errorData = jsonDecode(utf8.decode(response.bodyBytes));
      throw Exception(errorData['error'] ?? 'Failed to analyze text');
    }
  }
}
